// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import type { DisciplineDescriptor } from "@/types/discipline.types";
import type { Encounter } from "@/types/encounter.types";

import { EncountersDataTable } from "./EncountersTable";

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

async function render(games?: Map<string, DisciplineDescriptor>) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <EncountersDataTable rows={ROWS} columns={["tournament"]} games={games} />
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
