// @vitest-environment happy-dom
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import en from "@/i18n/messages/en.json";
import { LOL_METADATA } from "@/test/discipline-metadata";
import type { EncounterTeam } from "@/types/encounter.types";

import type { PregameCharacterAction, PregameCharacterBoard } from "../../types";
import PregameCharacterBans from "./PregameCharacterBans";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ROOM = en.pickBan.room;
const BLUE = 71;
const RED = 72;
const TEAMS = [
  { id: RED, slot: 2, name: "Quiet Foxes" },
  { id: BLUE, slot: 1, name: "Bright Wolves" }
] as unknown as EncounterTeam[];
const METADATA = {
  ...LOL_METADATA,
  discipline: { ...LOL_METADATA.discipline, character_classes: ["fighter", "mage"] }
};

function action(
  overrides: Partial<PregameCharacterAction> & Pick<PregameCharacterAction, "itemId" | "name" | "teamId">
): PregameCharacterAction {
  return { item: undefined, group: null, action: "ban", carriedFromRound: null, ...overrides };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(board: PregameCharacterBoard) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={en}>
        <PregameCharacterBans encounterId={1} metadata={METADATA} board={board} teams={TEAMS} />
      </NextIntlClientProvider>
    );
  });
}

describe("League's pregame bans", () => {
  it("lists each team's bans in the game's class order, badges a carried ban, and offers no lobby copy", async () => {
    await render({
      round: 2,
      actions: [
        action({ itemId: 1, name: "Annie", group: "mage", teamId: RED }),
        action({ itemId: 2, name: "Yorick", group: "fighter", teamId: RED, carriedFromRound: 1 }),
        action({ itemId: 3, name: "Garen", group: "fighter", teamId: BLUE, action: "protect" }),
        action({ itemId: 4, name: "Lux", group: "mage", teamId: BLUE })
      ],
      banned: [
        { group: "fighter", items: [{ itemId: 2, name: "Yorick", item: undefined }] },
        {
          group: "mage",
          items: [
            { itemId: 1, name: "Annie", item: undefined },
            { itemId: 4, name: "Lux", item: undefined }
          ]
        }
      ]
    });

    expect(container.textContent).toContain(ROOM.characterBans.eyebrow);
    // Columns in slot order, whatever order the seats arrive in.
    const columns = [...container.querySelectorAll<HTMLElement>("[data-character-bans]")];
    expect(columns.map((column) => column.dataset.characterBans)).toEqual(["1", "2"]);
    expect(columns[0].textContent).toContain("Bright Wolves");
    // Bans first, then the declared class order (fighter before mage) — not the alphabet.
    const rows = (column: HTMLElement) =>
      [...column.querySelectorAll("[data-character-action]")].map((row) =>
        row.querySelector("[title]")?.getAttribute("title")
      );
    expect(rows(columns[0])).toEqual(["Lux", "Garen"]);
    expect(rows(columns[1])).toEqual(["Yorick", "Annie"]);
    // The state reaches a screen reader as text, not only as an icon.
    expect(columns[0].textContent).toContain(ROOM.heroBans.state.protect);

    const carried = columns[1].querySelector<HTMLElement>('[data-carried-from="1"]');
    expect(carried?.textContent).toBe(ROOM.carried.badge.replace("{n}", "1"));

    expect(container.textContent).toContain(ROOM.heroBans.unavailableOn.replace("{n}", "2"));
    expect(
      [...container.querySelectorAll("[data-character-banned]")].map((row) => row.lastElementChild?.textContent)
    ).toEqual(["Yorick", "Annie", "Lux"]);

    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).not.toContain(ROOM.heroBans.copy);
    expect(container.textContent).not.toContain(ROOM.heroBans.hint);
  });

  it("says a team banned nothing, and renders nothing at all for an empty board", async () => {
    await render({
      round: 1,
      actions: [action({ itemId: 1, name: "Annie", group: "mage", teamId: RED })],
      banned: [{ group: "mage", items: [{ itemId: 1, name: "Annie", item: undefined }] }]
    });
    const [blue] = [...container.querySelectorAll<HTMLElement>("[data-character-bans]")];
    expect(blue.textContent).toContain(ROOM.heroBans.none);

    await render({ round: 1, actions: [], banned: [] });
    expect(container.innerHTML).toBe("");
  });
});
