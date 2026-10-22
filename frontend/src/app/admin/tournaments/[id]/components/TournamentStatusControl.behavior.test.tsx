// @vitest-environment happy-dom
//
// Hub header status actions. What is pinned here:
//  1. the primary is the first FORWARD transition the machine allows, and it
//     confirms before it moves anything;
//  2. the menu groups allowed transitions apart from forced ones, and only a
//     superuser gets the forced group;
//  3. the finished flag is its own button (superuser only) behind the same
//     confirmation, never a one-click toggle.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Tournament } from "@/types/tournament.types";
import { TournamentStatusControl } from "./TournamentStatusControl";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const transitionTournamentStatus = vi.fn();
const toggleTournamentFinished = vi.fn();

vi.mock("@/services/admin.service", () => ({
  default: {
    transitionTournamentStatus: (...args: unknown[]) => transitionTournamentStatus(...args),
    toggleTournamentFinished: (...args: unknown[]) => toggleTournamentFinished(...args)
  }
}));
vi.mock("@/lib/notify", () => ({ notify: { success: vi.fn() } }));
vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>();
  // `vi.mock` factories are hoisted above static imports, so the messages load here.
  const { default: en } = await import("@/i18n/messages/en.json");
  return {
    ...actual,
    useTranslations: (namespace?: string) =>
      actual.createTranslator({ locale: "en", messages: en, namespace: namespace as never }),
    useLocale: () => "en"
  };
});

const DRAFT = { id: 7, status: "draft", is_finished: false } as Tournament;
const mounted: Root[] = [];

async function mount(isSuperuser: boolean, tournament: Tournament = DRAFT) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push(root);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <TournamentStatusControl tournament={tournament} canUpdate isSuperuser={isSuperuser} />
      </QueryClientProvider>
    );
  });
  return container;
}

async function press(node: Element | null | undefined, type: "click" | "pointerdown" = "click") {
  if (!node) throw new Error("nothing to press");
  await act(async () => {
    node.dispatchEvent(
      type === "click"
        ? new MouseEvent("click", { bubbles: true })
        : new PointerEvent("pointerdown", { bubbles: true })
    );
  });
}

function button(text: string) {
  return [...document.querySelectorAll("button")].find((node) => node.textContent?.trim() === text);
}

/** Opens "Change status" and returns its groups by label. */
async function openMenu() {
  await press(button("Change status"), "pointerdown");
  return Object.fromEntries(
    [...document.querySelectorAll("[role='group']")].map((group) => [
      document.getElementById(group.getAttribute("aria-labelledby") ?? "")?.textContent,
      [...group.querySelectorAll("[role='menuitem']")].map((item) => item.textContent)
    ])
  );
}

beforeEach(() => {
  transitionTournamentStatus.mockReset().mockResolvedValue(DRAFT);
  toggleTournamentFinished.mockReset().mockResolvedValue(DRAFT);
});

async function unmountAll() {
  await act(async () => {
    for (const root of mounted.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
}

afterEach(unmountAll);

describe("TournamentStatusControl", () => {
  it("leads with the next forward step and confirms before moving", async () => {
    await mount(false);

    // draft -> [live, check_in, registration]: the first one ahead is Live.
    await press(document.querySelector("button[aria-label='Move to Live']"));
    expect(transitionTournamentStatus).not.toHaveBeenCalled();

    await press(button("Set Live"));
    expect(transitionTournamentStatus).toHaveBeenCalledWith(7, { status: "live", force: false });
  });

  it("never leads into a phase the tournament does not have", async () => {
    // check_in -> [draft, live, registration]: Draft is only a phase of a drafted tournament.
    await mount(false, { id: 7, status: "check_in", team_formation: "balancer", is_finished: false } as Tournament);
    expect(document.querySelector("button[aria-label='Move to Draft']")).toBeNull();
    await press(document.querySelector("button[aria-label='Move to Live']"));
    await press(button("Set Live"));
    expect(transitionTournamentStatus).toHaveBeenCalledWith(7, { status: "live", force: false });

    await unmountAll();

    await mount(false, { id: 7, status: "check_in", team_formation: "draft", is_finished: false } as Tournament);
    expect(document.querySelector("button[aria-label='Move to Draft']")).not.toBeNull();
  });

  it("groups allowed transitions apart from forced ones, forced for a superuser only", async () => {
    await mount(false);
    expect(await openMenu()).toEqual({ Allowed: ["Registration", "Check-in", "Live"] });

    await unmountAll();

    await mount(true);
    expect(await openMenu()).toEqual({
      Allowed: ["Registration", "Check-in", "Live"],
      Forced: ["Announced", "Playoffs", "Completed", "Archived"]
    });
  });

  it("keeps the finished flag a superuser's own button, behind the confirmation", async () => {
    await mount(false);
    expect(button("Mark finished")).toBeUndefined();

    await unmountAll();

    await mount(true);
    await press(button("Mark finished"));
    expect(toggleTournamentFinished).not.toHaveBeenCalled();

    const dialog = document.querySelector("[role='alertdialog']");
    expect(dialog?.textContent).toContain("Mark the tournament finished?");
    await press([...(dialog?.querySelectorAll("button") ?? [])].find((node) => node.textContent === "Mark finished"));
    expect(toggleTournamentFinished).toHaveBeenCalledWith(7);
  });
});
