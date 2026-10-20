// @vitest-environment happy-dom
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import en from "@/i18n/messages/en.json";
import type { Encounter } from "@/types/encounter.types";
import type { PickBanResolvedStep, PickBanSession, PickBanState } from "@/types/tournament.types";

import { PregameHeader } from "./PregameHeader";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const HOME = 71;
const AWAY = 72;

const encounter = {
  id: 4242,
  best_of: 3,
  teams: [
    { id: HOME, slot: 1, name: "Bright Wolves", seed: 1, score: 1 },
    { id: AWAY, slot: 2, name: "Quiet Foxes", seed: 4, score: 0 }
  ]
} as unknown as Encounter;

/** A `result_loser_first` side session: G1 opened by the seed opener (HOME), G1 won by HOME. */
function state(sequence: Partial<PickBanResolvedStep>[]): PickBanState {
  return {
    session: { status: "active", first_team_id: HOME } as PickBanSession,
    sequence: sequence.map((step, index) => ({ index, ...step }))
  } as PickBanState;
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

/** The seat names carrying the "Opens this round" marker. */
function openers(roomState: PickBanState, round: number): string[] {
  host ??= document.body.appendChild(document.createElement("div"));
  root ??= createRoot(host);
  act(() =>
    root!.render(
      <NextIntlClientProvider locale="en" messages={en}>
        <PregameHeader
          encounter={encounter}
          state={roomState}
          activePhase="hero"
          phases={[]}
          round={round}
          series={[]}
          returnTo="/tournaments/x"
        />
      </NextIntlClientProvider>
    )
  );
  return [...host.querySelectorAll(`[title="${en.pickBan.room.board.opens}"]`)].map(
    (marker) => marker.closest("div")?.querySelector("[title]")?.textContent ?? ""
  );
}

describe("PregameHeader", () => {
  it("marks the current round's opener: the seed opener in round 1, G1's loser in round 2", () => {
    const roundOne = { round: 1, actors: [HOME] };
    expect(openers(state([roundOne]), 1)).toEqual(["Bright Wolves"]);
    expect(openers(state([roundOne, { round: 2, actors: [AWAY] }]), 2)).toEqual(["Quiet Foxes"]);
  });
});
