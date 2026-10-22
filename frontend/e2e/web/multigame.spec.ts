import { openRegistration, type FormSchema } from "../support/flows";
import { expect, openPage, test } from "../support/fixtures";
import { createTournament, createWorkspace, uniq } from "../support/seed";
import { enableGames, seedModeAndMap, setMapPool } from "../support/workspace";

const ROLES_FORM: FormSchema = { schema_version: 1, sections: [{ key: "main", fields: [{ key: "roles", kind: "builtin", required: true, editable: true }] }] };

for (const { game, role, roleLabel } of [
  { game: "lol", role: "jungle", roleLabel: "Jungle" },
  { game: "deadlock", role: "agent", roleLabel: "Agent" },
] as const) {
  test(`${game}: the public tournament and participants pages render the game's roles`, async ({ page, adminApi, makeUser }) => {
    const ws = await createWorkspace(adminApi);
    await enableGames(adminApi, ws.id);
    const t = await createTournament(adminApi, ws.id, { discipline: game });
    const version = await openRegistration(adminApi, t.id, { form: ROLES_FORM, autoApprove: true });
    const player = await makeUser(game);
    await player.api.post(`/api/v1/tournaments/${t.id}/registration`, { form_version_id: version, answers: { roles: [{ role, is_primary: true }] } }, 201);

    await openPage(page, `/tournaments/${t.slug}`);
    await expect(page.getByRole("heading", { name: t.name })).toBeVisible();
    await openPage(page, `/tournaments/${t.slug}/participants`);
    // Rows are keyed by the game handle (none asked here); the role glyph carries the game's label.
    await expect(page.getByText("1 participant shown")).toBeVisible();
    await expect(page.getByRole("img", { name: roleLabel }).first()).toBeVisible();
  });
}

test("the Maps tab is absent without a map pool and lists the pool's maps by mode once configured", async ({ page, adminApi }) => {
  const ws = await createWorkspace(adminApi);
  const t = await createTournament(adminApi, ws.id);
  await openPage(page, `/tournaments/${t.slug}`);
  await expect(page.getByRole("heading", { name: t.name })).toBeVisible();
  await expect(page.getByRole("link", { name: "Maps", exact: true })).toHaveCount(0);

  const { mode, map } = await seedModeAndMap(adminApi, "overwatch", uniq("tab").slice(4));
  await setMapPool(adminApi, t.id, [map.id]);
  await openPage(page, `/tournaments/${t.slug}`);
  await page.getByRole("link", { name: "Maps", exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`/tournaments/${t.slug}/maps`));
  await expect(page.getByText(map.name).first()).toBeVisible();
  await expect(page.getByText(mode.name).first()).toBeVisible();
});

test("tournament list and statistics filter by game without crashing", async ({ page, adminApi }) => {
  const ws = await createWorkspace(adminApi);
  await enableGames(adminApi, ws.id);
  const lol = await createTournament(adminApi, ws.id, { discipline: "lol" });
  await openPage(page, "/tournaments?discipline=lol");
  await expect(page.getByText(lol.name).first()).toBeVisible();
  for (const game of ["overwatch", "lol", "deadlock"]) await openPage(page, `/statistics?discipline=${game}`);
});
