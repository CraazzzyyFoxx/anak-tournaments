// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import messages from "@/i18n/messages/en.json";
import type { GameScopeState } from "@/hooks/useGameScope";
import type { GameScopeInit, PageGameResolution } from "@/lib/site/discipline-scope";
import { gameScopeState } from "@/test/game-scope";

import { BlockGameTabs } from "./BlockGameTabs";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ scope: null as GameScopeState | null, refresh: vi.fn() }));
vi.mock("@/hooks/useGameScope", () => ({ useGameScope: () => mocks.scope }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

const INIT: GameScopeInit = { stored: "all", lastGame: null, axis: "all", hostLockedWorkspaceId: null, disciplines: null };
/** The block's "single" rows under an all-games scope: a game to read, and tabs over the area's games. */
const BLOCK_UNDER_ALL: PageGameResolution = {
  game: { kind: "game", code: "overwatch", source: "default" },
  pill: { kind: "all" },
  tabs: true,
  scope: "all"
};

let root: Root;
let container: HTMLElement;

async function mount() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <BlockGameTabs initial={INIT} />
      </NextIntlClientProvider>
    );
  });
}

beforeEach(() => {
  mocks.refresh.mockReset();
  document.body.innerHTML = "";
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
});

it("renders nothing when the block follows the page's game", async () => {
  mocks.scope = gameScopeState("lol");
  await mount();

  expect(container.querySelector('[role="tab"]')).toBeNull();
});

it("picks a block game without touching the URL, then re-renders the server blocks", async () => {
  const selectTab = vi.fn();
  mocks.scope = gameScopeState("overwatch", { resolution: BLOCK_UNDER_ALL, selectTab });
  await mount();

  const league = Array.from(container.querySelectorAll('[role="tab"]')).find((tab) => tab.id.endsWith("-trigger-lol"));
  expect(league).toBeTruthy();
  await act(async () => {
    league!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  });

  expect(selectTab).toHaveBeenCalledWith("lol", { url: false });
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
});
