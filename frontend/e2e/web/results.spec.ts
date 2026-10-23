import { expect, openPage, test } from "../support/fixtures";
import { seedBracket } from "../support/flows";
import { mapRuleset, roomUrl, seedRoom } from "../support/pickban";
import { expectAdvanced, finishVeto, openGame, readEncounter, reportSeries, series, sides } from "../support/results";

test("captains report a map in the pregame room; the opponent's matching report settles the series", async ({ adminApi, makeUser, pageAs }) => {
  const room = await seedRoom(adminApi, await makeUser("ca"), await makeUser("cb"), { hero: null, bestOf: 1, map: mapRuleset() });
  await finishVeto(adminApi, room);
  await openGame(adminApi, room.encounterId, 1);

  const a = await pageAs(room.a.captain);
  await openPage(a, roomUrl(room));
  await a.getByRole("button", { name: "Report the result" }).click();
  await a.getByLabel("Your team's score").fill("2");
  await a.getByLabel("Opponent's score").fill("1");
  await a.getByRole("button", { name: "Submit report" }).click();
  await expect(a.getByRole("button", { name: "Change my report" }), "the reporter can amend until the opponent files").toBeVisible();

  const b = await pageAs(room.b.captain);
  await openPage(b, roomUrl(room));
  await b.getByRole("button", { name: "Report the result" }).click();
  await b.getByLabel("Your team's score").fill("1");
  await b.getByLabel("Opponent's score").fill("2");
  await b.getByRole("button", { name: "Submit report" }).click();

  await expect
    .poll(async () => (await readEncounter(adminApi, room.encounterId)).result_status, { message: "matching UI reports confirm the Bo1" })
    .toBe("confirmed");
  const settled = await readEncounter(adminApi, room.encounterId);
  expect(settled.teams.find((t) => t.id === room.a.participationId)).toMatchObject({ score: 1, placement: 1 });

  await openPage(b, `/encounters/${room.encounterId}`);
  await expect(b.getByText(`Series won by ${room.a.name}`), "the encounter page shows the winner").toBeVisible();
});

test("organizer resolves a disputed series from the reports tab; bracket, matches and encounter pages follow", async ({ adminApi, makeUser, page }) => {
  const seed = await seedBracket(adminApi, { captains: await Promise.all([1, 2, 3, 4].map(() => makeUser("cap"))), players: false });
  const [semi, other] = seed.encounters.filter((e) => e.round === 1);
  const [home, away] = sides(seed, semi);
  const filed = await reportSeries(home.captain, semi.id, series(home.seat, away.seat, 2, 0));
  await reportSeries(away.captain, semi.id, series(away.seat, home.seat, 2, 1, { basis_version: filed.result_version }));
  const [otherHome, otherAway] = sides(seed, other);
  await reportSeries(otherHome.captain, other.id, series(otherHome.seat, otherAway.seat, 2, 1));
  await reportSeries(otherAway.captain, other.id, series(otherHome.seat, otherAway.seat, 2, 1));

  await openPage(page, `/admin/tournaments/${seed.tournament.id}/matches/reports`);
  await page.getByRole("row").filter({ hasText: home.team.name }).filter({ hasText: away.team.name }).first().click();
  await page.getByRole("button", { name: "Resolve result" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText(`Adopt ${home.team.name} report`).click();
  await dialog.getByLabel("Reason").fill("Checked the VOD");
  await dialog.getByRole("button", { name: "Confirm result" }).click();
  await expect(page.getByText("Result confirmed").first(), "the organizer sees the confirmation").toBeVisible();

  const resolved = await readEncounter(adminApi, semi.id);
  expect(resolved, "the UI resolution adopted the home report").toMatchObject({ result_status: "confirmed", result_source: "admin" });
  const final = await expectAdvanced(adminApi, seed.encounters, semi.id, 1, home.team.id);
  await expectAdvanced(adminApi, seed.encounters, other.id, 1, otherHome.team.id);

  await openPage(page, `/admin/tournaments/${seed.tournament.id}/bracket`);
  await expect(page.getByText(home.team.name).first(), "admin bracket shows the advanced team").toBeVisible();

  await openPage(page, `/tournaments/${seed.tournament.slug}/bracket`);
  await expect(page.getByText(home.team.name).first()).toBeVisible();
  await expect(page.getByText(otherHome.team.name).first()).toBeVisible();

  await openPage(page, `/tournaments/${seed.tournament.slug}/matches`);
  await expect(page.getByText(home.team.name).first(), "matches list carries the played semi").toBeVisible();

  await openPage(page, `/encounters/${semi.id}`);
  await expect(page.getByRole("heading", { name: `${home.team.name} vs ${away.team.name}` })).toBeVisible();
  await expect(page.getByText(`Series won by ${home.team.name}`)).toBeVisible();
  // An eliminated semi-finalist of a 4-team bracket can at best share 3rd; the header must not crown it.
  const placementBadge = await page.getByText(/Placement #\d+/).allInnerTexts();
  await page.getByRole("link", { name: "Pre-game" }).click();
  await expect(page.getByRole("region", { name: "Captain reports" }), "both captains' reports are shown").toContainText("2 reports filed");

  await openPage(page, `/encounters/${final.id}`);
  await expect(page.getByRole("heading", { name: `${home.team.name} vs ${otherHome.team.name}` }), "final is seated by both semis").toBeVisible();
  expect(placementBadge, "semi loser's placement badge while the final is unplayed").not.toContain("Placement #1");
});
