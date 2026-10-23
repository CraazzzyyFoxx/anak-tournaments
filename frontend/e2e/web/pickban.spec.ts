import type { Locator, Page } from "@playwright/test";
import { BASE_URL } from "../support/env";
import { test, expect, openPage } from "../support/fixtures";
import { act, actingSeat, readyBoth, recordRealtimeTopics, seedRoom, waitForSession, type Room, type Seat } from "../support/pickban";

const bar = (page: Page) => page.getByRole("region", { name: "Pick-ban command bar" });
const chat = (page: Page) => page.getByRole("complementary", { name: "Room chat" });
const readyRow = (page: Page, seat: Seat) => page.getByRole("list").getByRole("listitem").filter({ hasText: seat.name });
const seriesMaps = (page: Page) => page.getByRole("list", { name: "Maps of this series" });

/** A returning visitor: the undecided analytics notice is a fixed bottom strip over the command bar. */
async function declineAnalytics(page: Page) {
  await page.context().addCookies([{ name: "owt-cookie-consent", value: "declined", url: BASE_URL }]);
}

async function waitForRoom(page: Page, room: Room) {
  await declineAnalytics(page);
  await openPage(page, `/tournaments/${room.tournament.slug}/pregame/${room.encounterId}`);
  await expect(page.getByRole("heading", { name: "Pre-game Room", level: 1 })).toBeVisible();
}

test("two captains: readiness and the map veto stay in sync over the WebSocket", async ({ adminApi, makeUser, pageAs }) => {
  const [a, b] = [await makeUser("capa"), await makeUser("capb")];
  const room = await seedRoom(adminApi, a, b);
  const [m1, m2, m3, m4, m5] = room.maps;
  const veto = `encounter:${room.encounterId}:map-veto`;
  const pa = await pageAs(a);
  const pb = await pageAs(b);
  const topicsA = recordRealtimeTopics(pa);
  const topicsB = recordRealtimeTopics(pb);
  await waitForRoom(pa, room);
  await waitForRoom(pb, room);

  for (const page of [pa, pb]) {
    await expect(page.getByRole("heading", { name: "Waiting for both captains" })).toBeVisible();
    await expect(readyRow(page, room.a)).toContainText("Not ready");
  }

  // No session exists yet, so the room polls nothing: only the realtime signal can move B's screen.
  await pa.getByRole("button", { name: "I'm ready" }).click();
  await expect(pa.getByText("You're ready")).toBeVisible();
  await expect(readyRow(pb, room.a), "B sees A's readiness without a reload").not.toContainText("Not ready");
  await expect(readyRow(pb, room.a)).toContainText("Ready");
  expect(topicsB, "readiness arrived as a WebSocket event").toContain(veto);

  await pb.getByRole("button", { name: "I'm ready" }).click();
  for (const page of [pa, pb]) {
    await expect(page.getByText("Map Pool"), "both rooms leave the gate once the session opens").toBeVisible({ timeout: 30_000 });
  }
  const first = actingSeat(room, await waitForSession(a.api, room.encounterId, "map"));
  const second = first === room.a ? room.b : room.a;
  const [pFirst, pSecond] = first === room.a ? [pa, pb] : [pb, pa];
  const topicsSecond = first === room.a ? topicsB : topicsA;
  // Hide the chat so it can't sit over the map pool; the dock test covers the controls with it open.
  for (const page of [pa, pb]) await chat(page).getByRole("button", { name: "Hide the chat" }).click();

  await expect(bar(pFirst)).toContainText("Your turn");
  await expect(bar(pFirst)).toContainText(`Turn: ${first.name} — ban`);
  await expect(bar(pSecond)).toContainText(`Turn: ${first.name} — ban`);
  await expect(bar(pSecond)).not.toContainText("Your turn");
  await expect(bar(pFirst).getByText("Step timer"), "the open step shows its clock").toBeVisible();
  await expect(pSecond.getByRole("button", { name: `${m1.name} Available` }), "the waiting side cannot pick from the pool").toBeDisabled();

  // A bans through the pool and the command bar; B's screen follows over the socket.
  const eventsBefore = topicsSecond.filter((t) => t === veto).length;
  await pFirst.getByRole("button", { name: `${m1.name} Available` }).click();
  await bar(pFirst).getByRole("button", { name: `Ban ${m1.name}` }).click();
  await expect(pSecond.getByRole("button", { name: `${m1.name} Banned by ${first.name}` })).toBeVisible();
  await expect.poll(() => topicsSecond.filter((t) => t === veto).length, { message: "the ban reached the opponent as a WebSocket event" }).toBeGreaterThan(eventsBefore);
  await expect(bar(pSecond), "the turn flips to the opponent").toContainText("Your turn");
  await expect(bar(pSecond)).toContainText(`Turn: ${second.name} — ban`);
  await expect(bar(pFirst)).not.toContainText("Your turn");

  await pSecond.getByRole("button", { name: `${m2.name} Available` }).click();
  await bar(pSecond).getByRole("button", { name: `Ban ${m2.name}` }).click();
  await expect(pFirst.getByRole("button", { name: `${m2.name} Banned by ${second.name}` })).toBeVisible();
  await expect(bar(pFirst)).toContainText(`Turn: ${first.name} — pick`);

  await act(first.captain, room.encounterId, "map", m3.id, "pick");
  await act(second.captain, room.encounterId, "map", m4.id, "pick");
  // The decider settles the last map; the series' maps are on both screens, in play order.
  for (const page of [pa, pb]) {
    await expect(seriesMaps(page)).toContainText(m3.name);
    await expect(seriesMaps(page).getByRole("listitem")).toHaveCount(3);
    const items = seriesMaps(page).getByRole("listitem");
    await expect(items.nth(0)).toContainText(m3.name);
    await expect(items.nth(1)).toContainText(m4.name);
    await expect(items.nth(2)).toContainText(m5.name);
  }
  // Map 1 is settled, so round 1's hero bans open for the same two captains.
  await expect(pa.getByText("Hero Pool")).toBeVisible();
  await expect(pb.getByText("Hero Pool")).toBeVisible();
});

test("a spectator watches the room read-only", async ({ adminApi, makeUser, browser, pageErrors }) => {
  const [a, b] = [await makeUser("capa"), await makeUser("capb")];
  const room = await seedRoom(adminApi, a, b);
  const first = actingSeat(room, await readyBoth(room));
  const [m1, m2] = room.maps;
  await act(first.captain, room.encounterId, "map", m1.id, "ban");

  // A spectator: a context of its own, with no session.
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const anon = await context.newPage();
    anon.on("pageerror", (err) => pageErrors.push(`pageerror ${anon.url()}: ${err.message}`));
    await waitForRoom(anon, room);
    await expect(anon.getByRole("button", { name: `${m1.name} Banned by ${first.name}` })).toBeVisible();
    await expect(anon.getByRole("button", { name: `${m2.name} Available` })).toBeDisabled();
    await expect(bar(anon)).not.toContainText("Your turn");
    await expect(anon.getByRole("button", { name: "I'm ready" })).toHaveCount(0);
    await expect(anon.getByRole("button", { name: "Show admin UI" })).toHaveCount(0);
    await expect(chat(anon), "a pre-game chat is closed to spectators by default").toHaveCount(0);

    // The spectator's board follows the captains live.
    await act(first === room.a ? room.b.captain : room.a.captain, room.encounterId, "map", m2.id, "ban");
    await expect(anon.getByRole("button", { name: new RegExp(`${m2.name} Banned by`) })).toBeVisible();

    // Opened by staff, the chat reads but never writes.
    await adminApi.patch(`/api/v1/encounters/${room.encounterId}/chat/settings`, { spectators_can_read: true });
    await waitForRoom(anon, room);
    await expect(chat(anon)).toBeVisible();
    await expect(chat(anon)).toContainText("Read-only — only captains and organizers write here.");
    await expect(chat(anon).getByRole("textbox", { name: "Message to the room" })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("organizer: live pause from the room, the room history, and the rooms board", async ({ adminApi, makeUser, pageAs, page }) => {
  const [a, b] = [await makeUser("capa"), await makeUser("capb")];
  const room = await seedRoom(adminApi, a, b);
  const first = actingSeat(room, await readyBoth(room));
  await act(first.captain, room.encounterId, "map", room.maps[0].id, "ban");

  const captain = await pageAs(first.captain);
  await waitForRoom(captain, room);
  await waitForRoom(page, room);
  await expect(captain.getByText("Paused by the organizer")).toHaveCount(0);

  await page.getByRole("button", { name: "Show admin UI" }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(captain.getByText("Paused by the organizer"), "the captain's room shows the pause without a reload").toBeVisible();
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(captain.getByText("Paused by the organizer")).toHaveCount(0);

  await page.getByRole("button", { name: /^History/ }).click();
  const history = page.getByRole("log", { name: "Room history" });
  await expect(history).toContainText(`${first.name} banned ${room.maps[0].name}`);
  await expect(history).toContainText("Map veto paused");
  await expect(history).toContainText(/Map veto resumed after \d+s/);
  await expect(history).toContainText(`${room.a.name} marked ready`);

  // The tournament's board of rooms links back to this one.
  await openPage(page, `/admin/tournaments/${room.tournament.id}/matches/rooms`);
  const row = page.getByRole("row").filter({ hasText: room.a.name });
  await expect(row).toContainText(room.b.name);
  await expect(row).toContainText("Map veto");
  await row.getByRole("link", { name: "Open room" }).click();
  await expect(page).toHaveURL(new RegExp(`/pregame/${room.encounterId}`));
  await expect(page.getByRole("heading", { name: "Pre-game Room", level: 1 })).toBeVisible();
});

test("room chat: send, receive, delete and mute across the room", async ({ adminApi, makeUser, pageAs, page }) => {
  const [a, b] = [await makeUser("capa"), await makeUser("capb")];
  const room = await seedRoom(adminApi, a, b);
  const pa = await pageAs(a);
  const pb = await pageAs(b);
  const topicsB = recordRealtimeTopics(pb);
  await waitForRoom(pa, room);
  await waitForRoom(pb, room);
  const messages = (p: Page) => chat(p).getByRole("log", { name: "Room chat messages" });

  const code = `lobby code ${room.encounterId}-E2E`;
  await chat(pa).getByRole("textbox", { name: "Message to the room" }).fill(code);
  await chat(pa).getByRole("button", { name: "Send message" }).click();
  await expect(messages(pa)).toContainText(code);
  await expect(messages(pb), "B receives the message without a reload").toContainText(code);
  expect(topicsB).toContain(`encounter:${room.encounterId}:chat`);

  await messages(pa).getByText(code).click({ button: "right" });
  await pa.getByRole("menuitem", { name: "Delete message" }).click();
  await expect(messages(pa)).not.toContainText(code);
  await expect(messages(pb), "the deletion reaches the other captain").not.toContainText(code);

  await chat(pb).getByRole("textbox", { name: "Message to the room" }).fill("ready when you are");
  await chat(pb).getByRole("textbox", { name: "Message to the room" }).press("Enter");
  await expect(messages(pa)).toContainText("ready when you are");

  // The organizer moderates from the same room.
  await waitForRoom(page, room);
  await expect(messages(page)).toContainText("ready when you are");
  await messages(page).getByText("ready when you are").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Mute for 5 minutes" }).click();
  await expect(chat(pb), "the muted captain is told so").toContainText("You are muted until");
  await expect(chat(pb).getByRole("textbox", { name: "Message to the room" }), "the composer is gone while muted").toHaveCount(0);
});

test("the docked room chat leaves the room's own controls clickable @mobile", async ({ adminApi, makeUser, pageAs }) => {
  const [a, b] = [await makeUser("capa"), await makeUser("capb")];
  const room = await seedRoom(adminApi, a, b);
  const page = await pageAs(a);
  await waitForRoom(page, room);
  await expect(chat(page), "the chat opens with the room").toBeVisible();
  // Whether a real tap at the control's centre lands on it, not on something drawn over it.
  const reachable = (target: Locator) =>
    target.evaluate((el) => {
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    });

  const ready = page.getByRole("button", { name: "I'm ready" });
  expect.soft(await reachable(ready), "the open chat dock (#dock-stack) covers the readiness button").toBe(true);

  const first = actingSeat(room, await readyBoth(room));
  if (first !== room.a) await act(first.captain, room.encounterId, "map", room.maps[4].id, "ban");
  await expect(bar(page)).toContainText("Your turn");
  // Keyboard selection: a tap could land on the dock, which is what is under test.
  await page.getByRole("button", { name: `${room.maps[0].name} Available` }).press("Enter");
  const ban = bar(page).getByRole("button", { name: `Ban ${room.maps[0].name}` });
  await expect(ban).toBeEnabled();
  expect(await reachable(ban), "the open chat dock (#dock-stack) covers the command bar's Ban button").toBe(true);
});

test("captain room on a phone @mobile", async ({ adminApi, makeUser, pageAs }) => {
  const [a, b] = [await makeUser("capa"), await makeUser("capb")];
  const room = await seedRoom(adminApi, a, b);
  const pa = await pageAs(a);
  await waitForRoom(pa, room);
  // Hide the chat so it can't sit over the map pool; the dock test covers the controls with it open.
  await chat(pa).getByRole("button", { name: "Hide the chat" }).click();
  await pa.getByRole("button", { name: "I'm ready" }).click();
  await b.api.post(`/api/v1/encounters/${room.encounterId}/ready`);
  await expect(pa.getByText("Map Pool")).toBeVisible({ timeout: 30_000 });
  const first = actingSeat(room, await waitForSession(a.api, room.encounterId, "map"));
  if (first !== room.a) await act(first.captain, room.encounterId, "map", room.maps[4].id, "ban");

  await expect(bar(pa)).toContainText("Your turn");
  await pa.getByRole("button", { name: `${room.maps[0].name} Available` }).click();
  const ban = bar(pa).getByRole("button", { name: `Ban ${room.maps[0].name}` });
  await expect(ban).toBeInViewport();
  await ban.click();
  await expect(pa.getByRole("button", { name: `${room.maps[0].name} Banned by ${room.a.name}` })).toBeVisible();
  const overflow = await pa.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "the room fits the phone's width").toBeLessThanOrEqual(0);
});
