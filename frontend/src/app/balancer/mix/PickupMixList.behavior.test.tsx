// @vitest-environment happy-dom

import { NextIntlClientProvider } from "next-intl";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "@/i18n/messages/en.json";
import type { CustomGameListItem } from "@/services/custom-game.service";

import { ActiveMixes, MixHistory } from "./PickupMixList";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function lobby(index: number, matches = 0) {
  return {
    lobby_index: index,
    selected_variant_index: 0,
    next_map_id: null,
    balanced_at: null,
    team1_voice_channel_id: null,
    team2_voice_channel_id: null,
    matches_count: matches
  };
}

function game(id: number, overrides: Partial<CustomGameListItem> = {}): CustomGameListItem {
  return {
    id,
    workspace_id: 7,
    discipline: "overwatch",
    host_user_id: 9,
    co_hosts: [],
    host_display_name: "HostTag#1234",
    name: `Mix ${id}`,
    status: "completed",
    settings: { points_per_win: 0, team_names: {}, workspace_discord_channel_id: null },
    created_at: "2026-01-02T18:00:00Z",
    lobby_count: 1,
    lobbies: [lobby(0)],
    self_signup: "closed",
    self_role_edit: false,
    general_voice_channel_id: null,
    roster_shape: null,
    matches_count: 3,
    last_match_at: "2026-01-02T21:00:00Z",
    players_count: 10,
    roster_count: 12,
    maps: [],
    maps_count: 0,
    ...overrides
  };
}

const mounts: { root: Root; container: HTMLDivElement }[] = [];

afterEach(() => {
  for (const { root, container } of mounts.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

async function mount(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounts.push({ root, container });
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {node}
      </NextIntlClientProvider>
    );
  });
  return container;
}

async function click(node: Element | null | undefined) {
  if (!node) throw new Error("Expected a clickable node");
  await act(async () => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

const button = (container: ParentNode, label: string) =>
  [...container.querySelectorAll("button")].find((node) => node.textContent?.trim() === label);

function history(items: CustomGameListItem[], props: Partial<Parameters<typeof MixHistory>[0]> = {}) {
  const handlers = { onLoadMore: vi.fn(), onSearchChange: vi.fn(), onCreateGame: vi.fn(), onRetry: vi.fn() };
  return {
    handlers,
    node: (
      <MixHistory
        items={items}
        loading={false}
        updating={false}
        error={false}
        hasMore={false}
        loadingMore={false}
        search=""
        query=""
        nothingYet={false}
        canEdit={false}
        {...handlers}
        {...props}
      />
    )
  };
}

describe("ActiveMixes", () => {
  it("renders nothing when no mix is running", async () => {
    const container = await mount(<ActiveMixes games={[]} loading={false} error={false} onRetry={vi.fn()} />);
    expect(container.textContent).toBe("");
  });

  it("says which game each lobby is on, who signed up, and that signup is open", async () => {
    const container = await mount(
      <ActiveMixes
        games={[
          game(5, {
            status: "balanced",
            self_signup: "pool",
            lobby_count: 2,
            lobbies: [lobby(0, 10), lobby(1, 4)],
            roster_count: 16
          })
        ]}
        loading={false}
        error={false}
        onRetry={vi.fn()}
      />
    );

    const card = container.querySelector('a[href="/balancer/mix/5"]');
    expect(card?.textContent).toContain("Lobby A");
    expect(card?.textContent).toContain("game 11");
    expect(card?.textContent).toContain("Lobby B");
    expect(card?.textContent).toContain("game 5");
    expect(card?.textContent).toContain("16");
    expect(card?.textContent).toContain("Signup open");
  });

  it("shows no status for a mix still being prepared with signup closed", async () => {
    const container = await mount(
      <ActiveMixes games={[game(5, { status: "draft" })]} loading={false} error={false} onRetry={vi.fn()} />
    );
    expect(container.textContent).not.toContain("Signup open");
    expect(container.textContent).not.toContain("Teams ready");
  });
});

describe("MixHistory", () => {
  it("groups finished mixes under their month, newest first", async () => {
    const container = await mount(
      history([
        game(9, { created_at: "2026-02-14T18:00:00Z" }),
        game(8, { created_at: "2026-02-01T18:00:00Z" }),
        game(4, { created_at: "2026-01-20T18:00:00Z" })
      ]).node
    );

    const months = [...container.querySelectorAll("h3")].map((heading) => heading.textContent);
    expect(months).toEqual(["February 2026", "January 2026"]);
    const groups = [...container.querySelectorAll("section section")].map((group) =>
      [...group.querySelectorAll("a")].map((link) => link.getAttribute("href"))
    );
    expect(groups).toEqual([["/balancer/mix/9", "/balancer/mix/8"], ["/balancer/mix/4"]]);
  });

  it("names a cancelled mix, a second lobby, and the maps past the previews", async () => {
    const maps = ["Ilios", "Oasis", "Havana", "Hollywood"].map((name) => ({ name, image_path: null }));
    const container = await mount(
      history([game(3, { status: "cancelled", lobby_count: 2, lobbies: [lobby(0), lobby(1)], maps, maps_count: 6 })]).node
    );

    const row = container.querySelector('a[href="/balancer/mix/3"]');
    expect(row?.textContent).toContain("Cancelled");
    expect(row?.textContent).toContain("2 lobbies");
    expect(row?.textContent).toContain("Maps: Ilios, Oasis, Havana, Hollywood");
    expect(row?.textContent).toContain("+2");
  });

  it("loads the next page on request, and offers nothing once the last one is in", async () => {
    const more = history([game(1)], { hasMore: true });
    const container = await mount(more.node);
    await click(button(container, "Show more"));
    expect(more.handlers.onLoadMore).toHaveBeenCalledTimes(1);

    const last = await mount(history([game(1)]).node);
    expect(button(last, "Show more")).toBeUndefined();
  });

  it("explains a search with no results and clears it", async () => {
    const empty = history([], { search: "zz", query: "zz" });
    const container = await mount(empty.node);

    expect(container.textContent).toContain("No past mix matches “zz”.");
    await click(button(container, "Clear search"));
    expect(empty.handlers.onSearchChange).toHaveBeenCalledWith("");
  });

  it("offers creation for an empty directory only to hosts, and no search with nothing to search", async () => {
    const host = history([], { nothingYet: true, canEdit: true });
    const hostView = await mount(host.node);
    expect(hostView.querySelector('input[type="search"]')).toBeNull();
    await click(button(hostView, "Create mix"));
    expect(host.handlers.onCreateGame).toHaveBeenCalledTimes(1);

    const viewer = await mount(history([], { nothingYet: true }).node);
    expect(button(viewer, "Create mix")).toBeUndefined();
  });
});
