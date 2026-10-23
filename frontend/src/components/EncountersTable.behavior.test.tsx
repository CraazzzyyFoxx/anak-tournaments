// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import type { DisciplineDescriptor } from "@/types/discipline.types";
import type { Encounter } from "@/types/encounter.types";

import { EncountersDataTable, type EncounterColumnKey } from "./EncountersTable";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const GAMES = new Map(
  (
    [
      { code: "overwatch", name: "Overwatch", short_name: "OW", icon: null, enabled: true },
      { code: "lol", name: "League of Legends", short_name: "LoL", icon: null, enabled: true }
    ] as DisciplineDescriptor[]
  ).map((game) => [game.code, game])
);

const encounter = (id: number, discipline: string, tournament: string) =>
  ({ id, discipline, status: "open", teams: [], tournament: { name: tournament } }) as unknown as Encounter;

const ROWS = [encounter(1, "overwatch", "OW Cup"), encounter(2, "lol", "LoL Cup"), encounter(3, "retired", "Old Cup")];

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(
  games?: Map<string, DisciplineDescriptor>,
  rows: Encounter[] = ROWS,
  columns: EncounterColumnKey[] = ["tournament"]
) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <EncountersDataTable rows={rows} columns={columns} games={games} />
      </NextIntlClientProvider>
    );
  });
  // What a reader gets from each cell: the decorative mark is hidden, the game's name is not.
  return [...container.querySelectorAll("tbody td")].map((cell) => {
    const read = cell.cloneNode(true) as HTMLElement;
    read.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
    return read.textContent;
  });
}

describe("the encounters table's game marks", () => {
  it("names each row's game beside its tournament when the list spans games, an unknown game by its code", async () => {
    expect(await render(GAMES)).toEqual(["OverwatchOW Cup", "League of LegendsLoL Cup", "retiredOld Cup"]);
  });

  it("names no game when the list is one game's", async () => {
    expect(await render()).toEqual(["OW Cup", "LoL Cup", "Old Cup"]);
  });
});

describe("the encounters table's closeness bar", () => {
  it("fills its track to the row's closeness as a block, which an inline span with a width never does", async () => {
    // Vitest hands CSS imports back empty, so the stylesheet goes in as the browser would get it.
    const style = document.head.appendChild(document.createElement("style"));
    style.textContent = readFileSync(join(import.meta.dirname, "EncountersTable.css"), "utf8");
    try {
      await render(undefined, [{ ...encounter(1, "overwatch", "Cup"), closeness: 0.734 } as Encounter], ["closeness"]);
      const fill = container.querySelector<HTMLElement>(".m-close .fill");

      expect(fill?.style.width).toBe("73%");
      expect(getComputedStyle(fill as HTMLElement).display).toBe("block");
    } finally {
      style.remove();
    }
  });
});

describe("the encounters table's when column", () => {
  const row = (id: number, patch: Partial<Encounter>) =>
    ({
      ...encounter(id, "overwatch", "Cup"),
      played_at: null,
      is_live: false,
      scheduled_at: null,
      ...patch
    }) as Encounter;
  const tournament = { start_date: "2019-06-01T00:00:00Z", end_date: "2019-06-08T00:00:00Z" } as Encounter["tournament"];

  it("reads live from the server, a result by when it was played or else its tournament's day, a fixture by its slot", async () => {
    const cells = await render(
      undefined,
      [
        row(1, { is_live: true }),
        row(2, { status: "completed", played_at: "2019-06-07T18:30:00Z", tournament }),
        // Imported history: its stamps are the import's, never the day it was played.
        row(3, { status: "completed", tournament, started_at: "2025-01-07T09:00:00Z" }),
        // A start stamp without the server's live flag is not live.
        row(4, { scheduled_at: "2026-11-02T17:00:00Z", started_at: "2026-11-02T17:05:00Z" }),
        row(5, { status: "pending" })
      ],
      ["when"]
    );

    expect(cells[0]).toBe(`${en.common.now}${en.encounters.state.live}`);
    expect(cells[1]).toMatch(/^Jun 7/);
    expect(cells[2]).toBe("Jun 8, 2019");
    expect(cells[3]).toMatch(/^Nov 25:00\sPM$/);
    expect(cells[4]).toBe(en.encounters.state.upcoming);
  });
});
