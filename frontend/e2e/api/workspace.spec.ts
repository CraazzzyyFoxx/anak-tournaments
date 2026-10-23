import { poll } from "../support/api";
import { expect, test } from "../support/fixtures";
import { createTournament, createWorkspace, uniq } from "../support/seed";
import { addMember, enableGames, freshSession, systemRoles, type WorkspaceRead } from "../support/workspace";

test.describe("workspace settings", () => {
  test("branding, timezone, links and visibility round-trip; re-saving the same values succeeds", async ({ adminApi }) => {
    const ws = await createWorkspace(adminApi);
    const settings = {
      name: `${ws.name} renamed`,
      tagline: "Weekly mixes",
      timezone: "Asia/Tokyo",
      branding_enabled: true,
      brand_primary: "#ff0055",
      brand_accent: "#00aaee",
      discord_url: "https://discord.gg/e2e",
      is_hidden: true,
    };
    const saved = await adminApi.patch<WorkspaceRead & typeof settings>(`/api/v1/workspaces/${ws.id}`, settings);
    expect(saved).toMatchObject(settings);
    // The settings form re-sends the whole section on every save.
    await adminApi.patch(`/api/v1/workspaces/${ws.id}`, settings);
    expect(await adminApi.get(`/api/v1/workspaces/${ws.id}`)).toMatchObject(settings);

    // Blank colour/text clears instead of failing validation.
    const cleared = await adminApi.patch(`/api/v1/workspaces/${ws.id}`, { brand_accent: "", tagline: "  " });
    expect(cleared).toMatchObject({ brand_accent: null, tagline: null, brand_primary: "#ff0055" });
  });

  test("invalid settings are field errors, not 500s", async ({ adminApi }) => {
    const ws = await createWorkspace(adminApi);
    for (const [body, field] of [
      [{ timezone: "Mars/Olympus" }, "timezone"],
      [{ discord_url: "http://evil.example/discord" }, "discord_url"],
      [{ brand_primary: "red" }, "brand_primary"],
      [{ subdomain: "admin" }, "subdomain"],
      [{ name: "   " }, "name"],
    ] as const) {
      const res = await adminApi.raw("PATCH", `/api/v1/workspaces/${ws.id}`, { body });
      expect(res.status(), `PATCH ${JSON.stringify(body)}`).toBe(422);
      expect(JSON.stringify(await res.json())).toContain(field);
    }
  });

  test("hidden or unverified workspaces stay out of the public directory; trusted + visible is listed", async ({ adminApi, anonApi }) => {
    const ws = await createWorkspace(adminApi);
    const listed = async () => ((await anonApi.get<{ slug: string }[]>("/api/v1/workspaces")) ?? []).some((w) => w.slug === ws.slug);
    expect(await listed(), "a fresh (unverified) workspace is not in the directory").toBe(false);

    await adminApi.post(`/api/v1/workspaces/${ws.id}/verification`, { verification_status: "trusted" });
    // The directory is edge-cached; poll past its TTL.
    await poll(listed, "trusted workspace listed publicly", 60_000);

    await adminApi.patch(`/api/v1/workspaces/${ws.id}`, { is_hidden: true });
    await poll(async () => !(await listed()), "hidden workspace dropped from the directory", 60_000);
    // Hidden is "unlisted", not "gone": the id still resolves, and its owner still manages it.
    expect((await anonApi.get(`/api/v1/workspaces/${ws.id}`)).is_hidden).toBe(true);
    const mine = await adminApi.get<{ id: number }[]>("/api/v1/workspaces", { scope: "admin" });
    expect(mine.map((w) => w.id)).toContain(ws.id);
  });

  test("/workspaces/by-host resolves a platform subdomain and nothing else", async ({ adminApi, anonApi }) => {
    const ws = await createWorkspace(adminApi);
    const sub = uniq("sub").toLowerCase();
    await adminApi.patch(`/api/v1/workspaces/${ws.id}`, { subdomain: sub });
    const zone = "owt.craazzzyyfoxx.me";
    expect(await anonApi.get("/api/v1/workspaces/by-host", { host: `${sub}.${zone}:443` })).toEqual({ workspace_id: ws.id, slug: ws.slug });
    expect(await anonApi.get("/api/v1/workspaces/by-host", { host: `nope-${sub}.${zone}` })).toBeFalsy();
    // An unverified custom domain never resolves (fail-closed).
    await adminApi.post(`/api/v1/workspaces/${ws.id}/custom-domain`, { custom_domain: `${sub}.example.org` });
    expect(await anonApi.get("/api/v1/workspaces/by-host", { host: `${sub}.example.org` })).toBeFalsy();
  });

  test("quota usage and team formats per game", async ({ adminApi }) => {
    const ws = await createWorkspace(adminApi);
    await enableGames(adminApi, ws.id);
    const quota = await adminApi.get(`/api/v1/workspaces/${ws.id}/quota/usage`);
    expect(quota.workspace_id).toBe(ws.id);
    expect(quota.scopes.map((s: { scope: string }) => s.scope)).toContain("workspace");

    const lol = await adminApi.get(`/api/v1/workspaces/${ws.id}/team-formats/lol`);
    expect(lol.dimensions.map((d: { dimension: string }) => d.dimension)).toEqual(["position"]);
    expect(lol.rules.map((r: { role: { role: string } }) => r.role.role)).toEqual(["top", "jungle", "mid", "bot", "support"]);
    const ow = await adminApi.get(`/api/v1/workspaces/${ws.id}/team-formats/overwatch`);
    expect(ow.dimensions.map((d: { dimension: string }) => d.dimension)).toEqual(["player_role"]);

    const custom = { name: "5v5 + sub", starter_min: 5, starter_max: 5, substitute_min: 0, substitute_max: 1, dimensions: lol.dimensions, rules: lol.rules };
    await adminApi.put(`/api/v1/workspaces/${ws.id}/team-formats/lol`, custom);
    await adminApi.put(`/api/v1/workspaces/${ws.id}/team-formats/lol`, custom);
    expect(await adminApi.get(`/api/v1/workspaces/${ws.id}/team-formats/lol`)).toMatchObject({ name: "5v5 + sub", substitute_max: 1, source: "workspace" });
    // The overwatch format is untouched by the lol write.
    expect((await adminApi.get(`/api/v1/workspaces/${ws.id}/team-formats/overwatch`)).source).not.toBe("workspace");

    const foreignRole = await adminApi.raw("PUT", `/api/v1/workspaces/${ws.id}/team-formats/lol`, {
      body: { ...custom, rules: [{ role: { dimension: "player_role", role: "tank" }, hard_min: 1, hard_max: 1 }] },
    });
    expect(foreignRole.status(), "an Overwatch role in a LoL format").toBe(422);
  });
});

test.describe("members and RBAC", () => {
  test("the creator can manage a workspace straight after creating it", async ({ makeUser }) => {
    // Self-service flow: /get-workspace creates, then the wizard immediately saves the profile.
    const creator = await makeUser("own");
    const ws = await createWorkspace(creator.api);
    const res = await creator.api.raw("PATCH", `/api/v1/workspaces/${ws.id}`, { body: { tagline: "Fresh" } });
    expect(res.status(), `owner's first settings save -> ${res.status()} ${await res.text()}`).toBe(200);
  });

  test("owner/admin/host/player/outsider permission matrix", async ({ adminApi, makeUser }) => {
    const creator = await makeUser("own");
    const ws = await createWorkspace(creator.api);
    // The creator's token predates the workspace; see the test above for that gap.
    const owner = { api: await freshSession(creator) };
    const roles = await systemRoles(owner.api, ws.id);
    const [admin, host, player, outsider, extra] = await Promise.all(["adm", "hst", "plr", "out", "ext"].map((p) => makeUser(p)));
    await addMember(owner.api, ws.id, admin, roles.admin);
    await addMember(owner.api, ws.id, host, roles.host);
    await addMember(owner.api, ws.id, player, roles.player);
    await addMember(owner.api, ws.id, extra, roles.player);
    const as = {
      owner: owner.api,
      admin: await freshSession(admin),
      host: await freshSession(host),
      player: await freshSession(player),
      outsider: await freshSession(outsider),
    };

    const tournamentBody = () => ({
      workspace_id: ws.id,
      discipline: "overwatch",
      name: uniq("Rbac"),
      start_date: "2030-01-01",
      end_date: "2030-01-02",
      auto_transitions_enabled: false,
    });
    type Who = keyof typeof as;
    const expectations: { what: string; call: (api: (typeof as)[Who]) => Promise<number>; allowed: Who[] }[] = [
      {
        what: "read members",
        call: async (api) => (await api.raw("GET", `/api/v1/workspaces/${ws.id}/members`)).status(),
        allowed: ["owner", "admin", "host", "player"],
      },
      {
        what: "edit workspace settings",
        call: async (api) => (await api.raw("PATCH", `/api/v1/workspaces/${ws.id}`, { body: { tagline: "x" } })).status(),
        allowed: ["owner", "admin"],
      },
      {
        what: "create a tournament",
        call: async (api) => (await api.raw("POST", "/api/v1/admin/tournaments", { body: tournamentBody() })).status(),
        allowed: ["owner", "admin"],
      },
      {
        what: "write a team format",
        call: async (api) => {
          const fmt = await adminApi.get(`/api/v1/workspaces/${ws.id}/team-formats/overwatch`);
          const { name, starter_min, starter_max, substitute_min, substitute_max, dimensions, rules } = fmt;
          return (
            await api.raw("PUT", `/api/v1/workspaces/${ws.id}/team-formats/overwatch`, {
              body: { name, starter_min, starter_max, substitute_min, substitute_max, dimensions, rules },
            })
          ).status();
        },
        allowed: ["owner", "admin"],
      },
      {
        what: "change a member's roles",
        call: async (api) => (await api.raw("PATCH", `/api/v1/workspaces/${ws.id}/members/${extra.id}`, { body: { role_ids: [roles.referee] } })).status(),
        allowed: ["owner", "admin"],
      },
      {
        what: "remove a member",
        call: async (api) => (await api.raw("DELETE", `/api/v1/workspaces/${ws.id}/members/${extra.id}`)).status(),
        // workspace_member.delete is owner-only (rbac/catalog.py _admin_permission_names).
        allowed: ["owner"],
      },
    ];
    const verdicts: string[] = [];
    for (const { what, call, allowed } of expectations) {
      for (const who of Object.keys(as) as Who[]) {
        if (what === "remove a member" && who === "owner") continue; // run last, it consumes `extra`
        const status = await call(as[who]);
        const ok = status >= 200 && status < 300;
        if (ok !== allowed.includes(who)) verdicts.push(`${who} → ${what}: ${status} (expected ${allowed.includes(who) ? "2xx" : "403"})`);
        if (!ok) expect(status, `${who} → ${what} denied with a 4xx`).toBeLessThan(500);
      }
    }
    expect(verdicts, "RBAC matrix mismatches").toEqual([]);
    expect(await owner.api.delete(`/api/v1/workspaces/${ws.id}/members/${extra.id}`, 204)).toBeUndefined();
    await Promise.all(Object.values(as).map((api) => api.dispose()));
  });

  test("member lifecycle: add, change role, staff credit, remove", async ({ makeUser }) => {
    const creator = await makeUser("own");
    const ws = await createWorkspace(creator.api);
    const owner = { api: await freshSession(creator) };
    const roles = await systemRoles(owner.api, ws.id);
    expect(Object.keys(roles).sort()).toEqual(["admin", "host", "owner", "player", "referee"]);
    const member = await makeUser("mem");

    const added = await addMember(owner.api, ws.id, member, roles.player);
    expect(added.rbac_roles.map((r: { name: string }) => r.name)).toEqual(["player"]);
    const dup = await owner.api.raw("POST", `/api/v1/workspaces/${ws.id}/members`, { body: { auth_user_id: member.id, role_ids: [roles.player] } });
    expect(dup.status(), "adding an existing member twice").toBe(400);

    const promoted = await owner.api.patch(`/api/v1/workspaces/${ws.id}/members/${member.id}`, { role_ids: [roles.referee] });
    expect(promoted.rbac_roles.map((r: { name: string }) => r.name)).toEqual(["referee"]);
    const staff = await owner.api.get<{ role: string; name: string }[]>(`/api/v1/workspaces/${ws.id}/staff`);
    expect(staff.map((s) => s.role).sort()).toEqual(["owner", "referee"]);
    // Staff is public: names and roles only, no account identifiers.
    expect(JSON.stringify(staff)).not.toContain(member.email);

    // A fresh login reads the membership straight away.
    const memberApi = await freshSession(member);
    expect((await memberApi.raw("GET", `/api/v1/workspaces/${ws.id}/members`)).status()).toBe(200);

    await owner.api.delete(`/api/v1/workspaces/${ws.id}/members/${member.id}`, 204);
    const list = await owner.api.get<{ results: { auth_user_id: number }[] }>(`/api/v1/workspaces/${ws.id}/members`);
    expect(list.results.map((m) => m.auth_user_id)).not.toContain(member.id);
    const after = await freshSession(member);
    expect((await after.raw("GET", `/api/v1/workspaces/${ws.id}/members`)).status(), "removed member").toBe(403);
    await Promise.all([memberApi.dispose(), after.dispose(), owner.api.dispose()]);
  });

  test("adding a member by the role name the schema accepts is not a 500", async ({ makeUser }) => {
    // WorkspaceMemberCreate.role allows owner|admin|member, but the system roles are
    // owner/admin/referee/host/player — "member" resolves to nothing.
    const creator = await makeUser("own");
    const ws = await createWorkspace(creator.api);
    const owner = { api: await freshSession(creator) };
    const member = await makeUser("mem");
    const res = await owner.api.raw("POST", `/api/v1/workspaces/${ws.id}/members`, { body: { auth_user_id: member.id, role: "member" } });
    expect(res.status(), `POST members {role:"member"} -> ${res.status()} ${await res.text()}`).toBeLessThan(500);
    await owner.api.dispose();
  });
});

test.describe("preview access to a hidden tournament", () => {
  test("only allowlisted accounts see it, and revoking closes it again", async ({ adminApi, anonApi, makeUser }) => {
    const ws = await createWorkspace(adminApi);
    const t = await createTournament(adminApi, ws.id, { is_hidden: true });
    const [viewer, stranger] = await Promise.all([makeUser("view"), makeUser("strg")]);

    expect((await anonApi.raw("GET", `/api/v1/tournaments/${t.id}`)).status()).toBe(404);
    expect((await viewer.api.raw("GET", `/api/v1/tournaments/${t.id}`)).status()).toBe(404);

    await adminApi.post(`/api/v1/admin/tournaments/${t.id}/preview-access`, { auth_user_id: viewer.id }, 201);
    const grants = await adminApi.get<{ auth_user_id: number }[]>(`/api/v1/admin/tournaments/${t.id}/preview-access`);
    expect(grants.map((g) => g.auth_user_id)).toEqual([viewer.id]);

    expect((await viewer.api.get(`/api/v1/tournaments/${t.id}`)).id).toBe(t.id);
    expect((await viewer.api.get(`/api/v1/tournaments/${t.slug}`)).id).toBe(t.id);
    expect((await stranger.api.raw("GET", `/api/v1/tournaments/${t.id}`)).status()).toBe(404);
    expect((await anonApi.raw("GET", `/api/v1/tournaments/${t.id}`)).status()).toBe(404);
    const listing = await anonApi.get<{ results: { id: number }[] }>("/api/v1/tournaments", { workspace_id: ws.id });
    expect(listing.results.map((r) => r.id), "hidden tournament never listed").not.toContain(t.id);

    // Only workspace owner/admin manage the allowlist.
    const denied = await viewer.api.raw("POST", `/api/v1/admin/tournaments/${t.id}/preview-access`, { body: { auth_user_id: stranger.id } });
    expect(denied.status()).toBe(403);

    await adminApi.delete(`/api/v1/admin/tournaments/${t.id}/preview-access/${viewer.id}`, 204);
    await poll(async () => (await viewer.api.raw("GET", `/api/v1/tournaments/${t.id}`)).status() === 404, "revoked viewer gets 404", 40_000);
  });
});
