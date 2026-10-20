// @vitest-environment happy-dom
//
// The Game content shell (P5-1, F13; per-game since P7). What is pinned here:
//  1. the sections are tabs of one screen — the catalogues of the selected game, carrying its `?discipline=`, plus
//     the triage queue that works on them — labelled in that game's own words;
//  2. the path segment picks the active tab, so a deep link lands marked;
//  3. the queue badge carries its length, and an empty queue shows no badge;
//  4. a platform page (spec §3.7): URL over the first game, the URL never rewritten on landing; the game tabs push a
//     history entry and leave the scope alone; an invalid value is named and loads nothing; a kind the game does not
//     declare has no tab.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";

import messages from "@/i18n/messages/en.json";
import { navigation } from "@/test/url-navigation";
import { useWorkspaceStore } from "@/stores/workspace.store";
import GameContentLayout from "./layout";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getCatalogAliasMisses = vi.fn();

vi.mock("next/navigation", async () => (await import("@/test/url-navigation")).nextNavigationMock);
vi.mock("@/services/admin.service", () => ({
  default: { getCatalogAliasMisses: (...args: unknown[]) => getCatalogAliasMisses(...args) }
}));
vi.mock("@/services/discipline.service", () => ({
  default: {
    list: async () => [
      {
        code: "overwatch",
        name: "Overwatch",
        short_name: "OW",
        icon: null,
        enabled: true,
        kinds: { character: "Hero", map: "Map", mode: "Gamemode" },
        character_classes: ["tank", "damage", "support"]
      },
      {
        code: "lol",
        name: "League of Legends",
        short_name: "LoL",
        icon: null,
        enabled: true,
        kinds: { character: "Champion", map: "Map" },
        character_classes: ["Mage"]
      }
    ]
  }
}));

const mounted: { root: Root; container: HTMLElement }[] = [];

async function settle(turns = 8) {
  for (let turn = 0; turn < turns; turn += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
}

async function mount(url = "/admin/content/heroes?discipline=overwatch") {
  navigation.reset(url);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <QueryClientProvider client={client}>
          <GameContentLayout>
            <p>section body</p>
          </GameContentLayout>
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
  });
  await settle();
  return container;
}

const hrefs = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("a[data-link-tab]")).map((link) => link.getAttribute("href"));
const labels = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("a[data-link-tab]")).map((link) => link.textContent?.trim());

function tab(container: HTMLElement, key: string) {
  return container.querySelector<HTMLAnchorElement>(`a[data-link-tab="${key}"]`);
}

beforeEach(() => {
  useWorkspaceStore.setState({ gameScope: "all", hostLockedWorkspaceId: null, currentWorkspaceId: null });
  getCatalogAliasMisses.mockReset().mockResolvedValue({ results: [], total: 12, page: 1, per_page: 1 });
});

afterEach(async () => {
  await act(async () => {
    for (const { root, container } of mounted.splice(0)) {
      root.unmount();
      container.remove();
    }
  });
  document.body.innerHTML = "";
});

describe("admin Game content layout", () => {
  it("renders the sections as tabs of one screen, in the selected game's words, carrying the game", async () => {
    const container = await mount();

    expect(hrefs(container)).toEqual([
      "/admin/content/heroes?discipline=overwatch",
      "/admin/content/maps?discipline=overwatch",
      "/admin/content/gamemodes?discipline=overwatch",
      "/admin/content/unresolved"
    ]);
    expect(labels(container).slice(0, 3)).toEqual(["Hero", "Map", "Mode"]);
    expect(container.textContent).toContain("section body");
  });

  it("names League's character a Champion and offers no tab for a kind it does not declare", async () => {
    const container = await mount("/admin/content/heroes?discipline=lol");

    expect(labels(container).slice(0, 2)).toEqual(["Champion", "Map"]);
    expect(labels(container)).toHaveLength(3);
    expect(hrefs(container)).not.toContain("/admin/content/gamemodes?discipline=lol");
    expect(container.textContent).toContain("section body");
  });

  it("lands on the platform's first game without rewriting the URL", async () => {
    const container = await mount("/admin/content/maps");

    expect(navigation.replaces).toEqual([]);
    expect(navigation.pushes).toEqual([]);
    expect(hrefs(container)[0]).toBe("/admin/content/heroes?discipline=overwatch");
  });

  it("keeps an invalid game as typed, names it, and loads nothing", async () => {
    const container = await mount("/admin/content/heroes?discipline=starcraft");

    expect(container.textContent).toContain("starcraft");
    expect(container.textContent).not.toContain("section body");
    expect(navigation.replaces).toEqual([]);
    expect(navigation.current()).toBe("/admin/content/heroes?discipline=starcraft");
  });

  it("shows the unresolved queue for every game: no game is required", async () => {
    const container = await mount("/admin/content/unresolved");

    expect(tab(container, "unresolved")?.getAttribute("aria-current")).toBe("page");
    expect(container.textContent).toContain("section body");
  });

  it("marks the tab named by the path", async () => {
    const container = await mount("/admin/content/maps?discipline=overwatch");

    expect(tab(container, "maps")?.getAttribute("aria-current")).toBe("page");
    expect(tab(container, "heroes")?.getAttribute("aria-current")).toBeNull();
  });

  it("badges the queue with how much is waiting, and drops the badge when empty", async () => {
    let container = await mount();
    expect(getCatalogAliasMisses).toHaveBeenCalledWith({ page: 1, per_page: 1, include_resolved: false });
    expect(tab(container, "unresolved")?.textContent).toContain("12");

    getCatalogAliasMisses.mockResolvedValue({ results: [], total: 0, page: 1, per_page: 1 });
    container = await mount();
    expect(tab(container, "unresolved")?.textContent?.trim()).toBe("Unresolved names");
  });

  it("switches the game with its tabs, writing ?discipline= as a history entry and leaving the scope alone", async () => {
    await mount("/admin/content/heroes?discipline=overwatch");

    const tab = [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((node) =>
      node.textContent?.includes("League of Legends")
    );
    expect(tab).toBeTruthy();
    await act(async () => {
      tab!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    });
    await settle();

    const url = new URL(navigation.pushes.at(-1)!, "http://x");
    expect(url.pathname).toBe("/admin/content/heroes");
    expect(url.searchParams.get("discipline")).toBe("lol");
    expect(useWorkspaceStore.getState().gameScope).toBe("all");
  });
});
