import { expect, openPage, test } from "../support/fixtures";
import { createTournament, createWorkspace, uniq } from "../support/seed";
import { Api } from "../support/api";
import { enableGames, selectWorkspace } from "../support/workspace";

test("profile settings save, and re-saving the section succeeds again", async ({ page, context, adminApi }) => {
  const ws = await createWorkspace(adminApi);
  await selectWorkspace(context, ws.id);
  await openPage(page, "/admin/settings/general");
  const saveBar = page.getByRole("region", { name: "Unsaved changes" });
  for (const tagline of ["First tagline", "Second tagline"]) {
    await page.locator("#workspace-tagline").fill(tagline);
    await saveBar.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Settings saved").first()).toBeVisible();
    await expect(saveBar).toHaveCount(0);
    expect((await adminApi.get(`/api/v1/workspaces/${ws.id}`)).tagline).toBe(tagline);
  }
});

test("branding and visibility settings save", async ({ page, context, adminApi }) => {
  const ws = await createWorkspace(adminApi);
  await selectWorkspace(context, ws.id);
  await openPage(page, "/admin/settings/branding");
  await page.locator("#branding-enabled").click();
  await page.locator("#brand-primary").fill("#ff0055");
  await page.getByRole("region", { name: "Unsaved changes" }).getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Settings saved").first()).toBeVisible();
  expect(await adminApi.get(`/api/v1/workspaces/${ws.id}`)).toMatchObject({ branding_enabled: true, brand_primary: "#ff0055" });

  await openPage(page, "/admin/settings/visibility");
  await page.locator("#workspace-is-hidden").click();
  await page.getByRole("region", { name: "Unsaved changes" }).getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Settings saved").first()).toBeVisible();
  expect((await adminApi.get(`/api/v1/workspaces/${ws.id}`)).is_hidden).toBe(true);
});

const ADMIN_PAGES: [string, string | RegExp][] = [
  ["/admin/settings/domain", "Domain"],
  ["/admin/settings/statuses", "Roles & statuses"],
  ["/admin/settings/sub-roles", "Roles & statuses"],
  ["/admin/settings/quota", "Subscriptions & limits"],
  ["/admin/settings/subscriptions", "Subscriptions & limits"],
  ["/admin/settings/registration-forms", "Registration forms"],
  ["/admin/settings/divisions", "Divisions"],
  ["/admin/settings/divisions/import", /Import/],
  ["/admin/content/maps", "Game content"],
  ["/admin/content/heroes", "Game content"],
  ["/admin/content/gamemodes", "Game content"],
  ["/admin/content/unresolved", "Game content"],
  ["/admin/members", "Members"],
  ["/admin/access/roles", "Access"],
  ["/admin/access/permissions", "Access"],
  ["/admin/access/api-keys", "Access"],
  ["/admin/access/sessions", "Access"],
  ["/admin/people", "People"],
];

test("workspace admin pages render for a multi-game workspace", async ({ page, context, adminApi }) => {
  const ws = await createWorkspace(adminApi);
  await enableGames(adminApi, ws.id);
  await selectWorkspace(context, ws.id);
  for (const [url, heading] of ADMIN_PAGES) {
    await openPage(page, url);
    await expect(page.getByRole("heading", { name: heading }).first(), url).toBeVisible();
  }
  // Every enabled game has its grid, and every game's roles are offered for sub-roles.
  await openPage(page, "/admin/settings/divisions");
  for (const game of ["Overwatch", "League of Legends", "Deadlock"]) await expect(page.getByText(game, { exact: true }).first()).toBeVisible();
  await openPage(page, "/admin/settings/sub-roles");
  for (const role of ["Tank", "Jungle", "Agent"]) await expect(page.getByText(role, { exact: true }).first()).toBeVisible();
  await expect(page.getByPlaceholder("Add a sub-role…")).toHaveCount(3 + 5 + 1);
});

test("the dashboard shows every game's tournaments", async ({ page, context, adminApi }) => {
  const ws = await createWorkspace(adminApi);
  await enableGames(adminApi, ws.id);
  const made = await Promise.all((["overwatch", "lol", "deadlock"] as const).map((discipline) => createTournament(adminApi, ws.id, { discipline })));
  await selectWorkspace(context, ws.id);
  await openPage(page, "/admin");
  for (const t of made) await expect(page.getByRole("link", { name: t.name })).toBeVisible();
  for (const game of ["Overwatch", "League of Legends", "Deadlock"]) await expect(page.getByText(game, { exact: true }).first()).toBeVisible();
});

test("an API key is listed, works as a bearer token, and stops working once revoked", async ({ page, context, adminApi }) => {
  const ws = await createWorkspace(adminApi);
  const t = await createTournament(adminApi, ws.id);
  const name = uniq("key");
  const created = await adminApi.post<{ api_key: { id: number }; key: string }>(
    "/api/v1/auth/api-keys",
    { name, workspace_id: ws.id, scopes: ["tournament.read"] },
    201
  );
  await selectWorkspace(context, ws.id);
  await openPage(page, "/admin/access/api-keys");
  await expect(page.getByText(name)).toBeVisible();

  const keyApi = await Api.create(created.key);
  expect((await keyApi.get(`/api/v1/admin/tournaments/${t.id}`)).id).toBe(t.id);
  expect((await keyApi.raw("PATCH", `/api/v1/workspaces/${ws.id}`, { body: { tagline: "x" } })).status(), "scope ceiling").toBe(403);
  await adminApi.delete(`/api/v1/auth/api-keys/${created.api_key.id}`, 204);
  // The gateway caches a key's verdict for 5 s (principal/resolver.go apiKeyCacheTTL).
  await expect.poll(async () => (await keyApi.raw("GET", `/api/v1/admin/tournaments/${t.id}`)).status(), { timeout: 15_000 }).toBe(401);
  await keyApi.dispose();
});

const TOURNAMENT_SECTIONS = ["general", "registration", "roster", "pre-game", "scoring", "schedule", "rules", "preview", "admission", "report-form", "links", "danger"];

test("every tournament settings section opens for the organizer", async ({ page, context, adminApi }) => {
  const ws = await createWorkspace(adminApi);
  const t = await createTournament(adminApi, ws.id);
  const draft = await createTournament(adminApi, ws.id, { team_formation: "draft" });
  await selectWorkspace(context, ws.id);
  for (const section of TOURNAMENT_SECTIONS) {
    await openPage(page, `/admin/tournaments/${t.id}/settings/${section}`);
    await expect(page.getByText("Not permitted"), section).toHaveCount(0);
  }
  await openPage(page, `/admin/tournaments/${draft.id}/settings/draft`);
  await expect(page.getByText("Not permitted")).toHaveCount(0);

  // Rules: a saved document round-trips through the save bar, twice.
  await openPage(page, `/admin/tournaments/${t.id}/settings/rules`);
  for (const rules of ["# Rules v1", "# Rules v2"]) {
    await page.getByRole("textbox").first().fill(rules);
    await page.getByRole("region", { name: "Unsaved changes" }).getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("region", { name: "Unsaved changes" })).toHaveCount(0);
    await expect.poll(async () => (await adminApi.get(`/api/v1/admin/tournaments/${t.id}`)).rules).toBe(rules);
  }
});
