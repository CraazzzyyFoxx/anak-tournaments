// @vitest-environment happy-dom
//
// The rail row is either a PICKER or an EXIT, never both, and which one it is
// is decided by whether the entry can carry a frame. Getting that wrong is the
// expensive failure: a button for a YouTube channel would swap the theater to
// something it cannot play (a blank box), and a plain link for a live Twitch
// channel would send the viewer off the site the page exists to keep them on.
//
// The row must also stay a SINGLE interactive element. A nested link inside the
// button is invalid HTML, is unreachable by keyboard, and is exactly what the
// card grid this replaced did wrong.
import { NextIntlClientProvider } from "next-intl";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import type { StreamEntry } from "@/types/stream.types";

import { StreamRow } from "./StreamRow";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;

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

function render(entry: StreamEntry, { isSelected = false, selectable = true, now = null as number | null } = {}) {
  const onSelect = vi.fn();
  const root = createRoot(container);
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={en}>
        <StreamRow
          entry={entry}
          isSelected={isSelected}
          onSelect={selectable ? onSelect : null}
          now={now}
        />
      </NextIntlClientProvider>
    )
  );
  return onSelect;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
});

describe("StreamRow", () => {
  it("puts the whole row on one control, with no nested interactive element", () => {
    render(streamEntry({ player: { id: 7, name: "someplayer", avatar_url: null, team: null } }));

    expect(container.querySelectorAll("button, a")).toHaveLength(1);
  });

  it("hands the entry to the theater when picked", () => {
    const onSelect = render(streamEntry());

    act(() => container.querySelector("button")?.click());

    expect(onSelect).toHaveBeenCalledOnce();
  });

  // `aria-current` and not `aria-pressed`: this is "the one being shown" out of
  // a set, not an independent toggle the viewer can switch back off.
  it("marks the row in the frame as the current one", () => {
    render(streamEntry(), { isSelected: true });

    expect(container.querySelector("button")?.getAttribute("aria-current")).toBe("true");
  });

  it("leaves an unselected row with no current marker at all", () => {
    render(streamEntry(), { isSelected: false });

    expect(container.querySelector("button")?.getAttribute("aria-current")).toBeNull();
  });

  it("becomes an outbound link when the entry cannot carry a frame", () => {
    render(streamEntry({ platform: "youtube", url: "https://youtube.com/@somestreamer" }), {
      selectable: false
    });

    expect(container.querySelector("button")).toBeNull();
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://youtube.com/@somestreamer");
    expect(link?.getAttribute("rel")).toContain("noopener");
  });

  // The player, not the channel, is what a spectator scans a tournament page
  // for; the channel is only the fallback for an entry with nobody behind it.
  it("leads with the player and falls back to the channel", () => {
    render(streamEntry({ player: { id: 7, name: "someplayer", avatar_url: null, team: null } }));
    expect(container.textContent).toContain("someplayer");

    container.innerHTML = "";
    render(streamEntry({ player: null }));
    expect(container.textContent).toContain("somestreamer");
  });

  it("shows no uptime before the client clock exists", () => {
    render(streamEntry({ started_at: "2026-08-16T09:00:00Z" }), { now: null });

    expect(container.textContent).not.toMatch(/\dh|\dm/);
  });

  it("shows uptime once the clock arrives", () => {
    const started = Date.parse("2026-08-16T09:00:00Z");
    render(streamEntry({ started_at: "2026-08-16T09:00:00Z" }), {
      now: started + 3 * 3_600_000 + 12 * 60_000
    });

    expect(container.textContent).toContain("3h 12m");
  });
});
