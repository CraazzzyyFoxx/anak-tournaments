// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import en from "@/i18n/messages/en.json";
import type { PickBanState } from "@/types/tournament.types";

import { PregameAdminControls } from "./PregameAdminControls";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ADMIN = en.pickBan.room.admin;
const SEATS = [
  { id: 71, slot: 1, name: "Bright Wolves" },
  { id: 72, slot: 2, name: "Quiet Foxes" }
];
/** A live hero session between steps: every session command is on offer. */
const STATE = {
  session: { id: 1, status: "active", paused_at: null, awaiting_choice: false, current_step_started_at: null },
  current_step: null,
  is_complete: false,
  submissions: [],
  sequence: [],
  step_progress: {},
  acting_team_ids: [],
  dispute: { step_index: null },
  targets: {}
} as unknown as PickBanState;

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

async function render(technicalLoss?: boolean) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <NextIntlClientProvider locale="en" messages={en}>
          <PregameAdminControls
            kind="hero"
            encounterId={1}
            state={STATE}
            selectedItemId={null}
            selectedItemName={null}
            itemsById={{}}
            sideLabels={[]}
            games={[]}
            blind={null}
            seats={SEATS}
            bestOf={1}
            seriesWins={null}
            onMutated={() => {}}
            technicalLoss={technicalLoss}
          />
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  });
}

const buttonLabels = () => [...container.querySelectorAll("button")].map((button) => button.textContent?.trim());

describe("the pick-ban organizer controls", () => {
  it("offer the technical loss by default and drop only it where the room writes no result", async () => {
    await render();
    expect(buttonLabels()).toEqual(
      expect.arrayContaining([ADMIN.cancelSession, ADMIN.reset, ADMIN.technicalLoss])
    );

    await render(false);
    expect(buttonLabels()).toEqual(expect.arrayContaining([ADMIN.cancelSession, ADMIN.reset]));
    expect(buttonLabels()).not.toContain(ADMIN.technicalLoss);
  });
});
