// @vitest-environment happy-dom
//
// Two contracts live here.
//
// The team caption has one failure mode worth pinning: a participant with no
// team is the ORDINARY state, not a hole. Rosters are formed by the balancer,
// and players stream during check-in — hours before any team exists. A caption
// that rendered a dash, an empty element, or "Team undefined" in that window
// would report a broken roster on every tournament that has not been balanced
// yet. (This rule moved here from the card grid this component replaced; the
// theater is now the only place a participant's identity is spelled out,
// because the rail rows are buttons and cannot nest a profile link.)
//
// The poster gate is the other: the caller decides whether a frame may mount,
// because `TournamentBroadcastDock` may already be playing in the corner. A
// theater that mounted its own iframe regardless would put two live streams on
// one screen.
import { NextIntlClientProvider } from "next-intl";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import type { StreamEntry } from "@/types/stream.types";

// The real Link needs an app router; the contract here is the `href` it points
// at, which the shim passes straight through.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}));

import { StreamTheater } from "./StreamTheater";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;

/**
 * Every field spelled out rather than cast into place: `tsconfig.json` excludes
 * test files, so a fixture that lies about its shape type-checks green and
 * feeds the component a hole.
 */
function streamEntry(overrides: Partial<StreamEntry> = {}): StreamEntry {
  return {
    platform: "twitch",
    channel: "somestreamer",
    url: "https://twitch.tv/somestreamer",
    live: true,
    title: "ranked grind",
    game_name: "Overwatch 2",
    viewer_count: 12,
    thumbnail_url: null,
    started_at: null,
    player: null,
    ...overrides
  };
}

function render(entry: StreamEntry, { isPlaying = false } = {}) {
  const onPlay = vi.fn();
  const root = createRoot(container);
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={en}>
        <StreamTheater entry={entry} isPlaying={isPlaying} onPlay={onPlay} now={null} />
      </NextIntlClientProvider>
    )
  );
  return { onPlay, unmount: () => act(() => root.unmount()) };
}

/** The heading that names whoever is in the frame. */
function identityText() {
  return container.querySelector("h3")?.textContent?.trim() ?? null;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
});

describe("StreamTheater identity", () => {
  it("names the team the player is on in this tournament", () => {
    render(
      streamEntry({
        player: { id: 7, name: "someplayer", avatar_url: null, team: { id: 3, name: "Alpha" } }
      })
    );

    expect(identityText()).toBe(`someplayer${en.stream.card.team.replace("{team}", "Alpha")}`);
  });

  // The caption must not survive as an empty element or a placeholder: no team
  // yet is normal, and "—" would read as a roster that exists and is blank.
  it("renders nothing beside the player when there is no team yet", () => {
    render(
      streamEntry({
        player: { id: 7, name: "someplayer", avatar_url: null, team: null }
      })
    );

    expect(identityText()).toBe("someplayer");
  });

  it("keeps the profile link intact with a team", () => {
    render(
      streamEntry({
        player: { id: 7, name: "someplayer", avatar_url: null, team: { id: 3, name: "Alpha" } }
      })
    );

    expect(container.querySelector('a[href^="/users/"]')?.getAttribute("href")).toBe(
      "/users/someplayer"
    );
  });

  // An official broadcast has no player behind it, so there is no profile to
  // link to — the channel stands in as the heading.
  it("falls back to the channel with no profile link for an official broadcast", () => {
    render(streamEntry({ player: null }));

    expect(container.querySelector('a[href^="/users/"]')).toBeNull();
    expect(identityText()).toBe("somestreamer");
  });
});

describe("StreamTheater frame gate", () => {
  it("shows a poster button instead of a frame until the caller says play", () => {
    const { onPlay } = render(streamEntry(), { isPlaying: false });

    expect(container.querySelector("iframe")).toBeNull();
    const play = container.querySelector("button");
    expect(play?.textContent).toContain("somestreamer");

    act(() => play?.click());
    expect(onPlay).toHaveBeenCalledOnce();
  });

  it("mounts the player once the caller allows it", () => {
    render(streamEntry(), { isPlaying: true });

    const src = container.querySelector("iframe")?.getAttribute("src") ?? "";
    expect(src).toContain("channel=somestreamer");
    expect(container.querySelector("button")).toBeNull();
  });

  // Nothing can be embedded, so there is nothing to offer: a play button that
  // could never produce a frame is worse than no button.
  it("offers no play button for a platform with no player", () => {
    render(
      streamEntry({ platform: "youtube", url: "https://youtube.com/@somestreamer", live: null }),
      { isPlaying: true }
    );

    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector('a[href^="https://youtube.com"]')).not.toBeNull();
  });
});
