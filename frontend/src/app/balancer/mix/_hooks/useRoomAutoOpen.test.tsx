// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CustomGameLobby } from "@/services/custom-game.service";

import { useRoomAutoOpen } from "./useRoomAutoOpen";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

function lobby(overrides: Partial<CustomGameLobby>): CustomGameLobby {
  return {
    lobby_index: 1,
    balance_result: null,
    selected_variant_index: 0,
    next_map_id: null,
    balanced_at: null,
    live_encounter_id: null,
    state: "ready",
    lineup_recorded: true,
    matches_count: 0,
    ...overrides,
  };
}

const PREGAME = { state: "pregame", live_encounter_id: 50 } as const;

function Probe({ seat, canWrite = false }: { seat: CustomGameLobby | undefined; canWrite?: boolean }) {
  useRoomAutoOpen(3, seat, canWrite);
  return null;
}

let container: HTMLDivElement;
let root: Root;

async function render(seat: CustomGameLobby | undefined, canWrite = false) {
  await act(async () => {
    root.render(<Probe seat={seat} canWrite={canWrite} />);
  });
}

beforeEach(() => {
  push.mockReset();
  window.sessionStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("useRoomAutoOpen", () => {
  it("opens the room once per phase, however often the lobby re-renders", async () => {
    await render(lobby(PREGAME));
    await render(lobby({ ...PREGAME, live_started_at: "2026-10-23T20:00:00Z" }));

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/balancer/mix/3/lobby/B");
    expect(window.sessionStorage.getItem("mix-room-nav:3:1:pregame:50")).not.toBeNull();
  });

  it("opens it again for a new phase: the draft after it, or the next match", async () => {
    await render(lobby({ state: "draft_setup", draft_session_id: 77 }));
    // Setup going live is the same draft.
    await render(lobby({ state: "draft_live", draft_session_id: 77 }));
    await render(lobby(PREGAME));
    await render(lobby({ ...PREGAME, live_encounter_id: 51 }));

    expect(push).toHaveBeenCalledTimes(3);
    expect(window.sessionStorage.getItem("mix-room-nav:3:1:draft:77")).not.toBeNull();
  });

  it("never moves a writer", async () => {
    await render(lobby(PREGAME), true);
    await render(lobby({ state: "draft_live", draft_session_id: 77 }), true);

    expect(push).not.toHaveBeenCalled();
  });

  it("does not bounce a player back once this tab took them there", async () => {
    window.sessionStorage.setItem("mix-room-nav:3:1:pregame:50", "1");
    await render(lobby(PREGAME));

    expect(push).not.toHaveBeenCalled();
  });

  it("leaves a lobby that is ready or live, and a viewer with no seat, where they are", async () => {
    await render(lobby({ state: "ready" }));
    await render(lobby({ state: "live", live_encounter_id: 50 }));
    await render(undefined);

    expect(push).not.toHaveBeenCalled();
  });
});
