// @vitest-environment happy-dom
//
// The card's team caption has one failure mode worth pinning: a participant
// with no team is the ORDINARY state, not a hole. Rosters are formed by the
// balancer, and players stream during check-in — hours before any team exists.
// A caption that renders a dash, an empty element, or "Team undefined" in that
// window would report a broken roster on every tournament that has not been
// balanced yet.
import { NextIntlClientProvider } from "next-intl";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import type { StreamEntry } from "@/types/stream.types";

// The real Link needs an app router; the card's contract here is the `href` it
// points at, which the shim passes straight through.
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

import { StreamCard } from "./StreamCard";

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

function render(entry: StreamEntry) {
  const root = createRoot(container);
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={en}>
        <StreamCard entry={entry} />
      </NextIntlClientProvider>
    )
  );
  return () => act(() => root.unmount());
}

/** The player link plus whatever caption sits beside it. */
function playerBlockText() {
  const link = container.querySelector<HTMLAnchorElement>('a[href^="/users/"]');
  return link?.parentElement?.textContent?.trim() ?? null;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
});

describe("StreamCard participant caption", () => {
  it("names the team the player is on in this tournament", () => {
    render(
      streamEntry({
        player: { id: 7, name: "someplayer", avatar_url: null, team: { id: 3, name: "Alpha" } }
      })
    );

    expect(playerBlockText()).toBe(`someplayer${en.stream.card.team.replace("{team}", "Alpha")}`);
  });

  // The caption must not survive as an empty element or a placeholder: no team
  // yet is normal, and "—" would read as a roster that exists and is blank.
  it("renders nothing beside the player when there is no team yet", () => {
    render(
      streamEntry({
        player: { id: 7, name: "someplayer", avatar_url: null, team: null }
      })
    );

    expect(playerBlockText()).toBe("someplayer");
  });

  // The team is a caption ON the profile link, so adding it must not have cost
  // the card its only way to the player's page.
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

  it("renders no caption at all for an official broadcast", () => {
    render(streamEntry({ player: null }));

    expect(container.querySelector('a[href^="/users/"]')).toBeNull();
  });
});
