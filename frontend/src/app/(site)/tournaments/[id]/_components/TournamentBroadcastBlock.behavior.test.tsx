// @vitest-environment happy-dom
//
// `embeddable` is true only for `live`, so between series the block had a frame
// it could not fill and fell back to a bare "Watch on …" link — while several
// participants were on air the whole time. The participant fallback closes that
// gap, and every property pinned here is one that would quietly ruin it:
//
//  1. an official cast is never displaced, however many viewers a participant has;
//  2. with no official cast live, the busiest live participant fills the frame;
//  3. an entry the poller has not counted (`viewer_count: null`) does not
//     outrank one it has — otherwise an unstamped channel jumps the queue;
//  4. the pick does not move on ties. This list is refetched on every poller
//     tick, so an order-dependent winner would remount the iframe each time and
//     restart playback under the viewer;
//  5. the frame says whose POV it is. A spectator who reads a one-sided POV as
//     the cast will read the match wrong;
//  6. the official links survive the fallback — it hides no way to the cast.
import { NextIntlClientProvider } from "next-intl";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import en from "@/i18n/messages/en.json";
import type { StreamEntry, TournamentStreams } from "@/types/stream.types";

import { TournamentBroadcastBlock } from "./TournamentBroadcastBlock";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let unmount: (() => void) | null = null;

/**
 * Every field spelled out rather than cast into place: `tsconfig.json` excludes
 * test files, so a fixture that lies about its shape type-checks green and
 * feeds the component a hole.
 */
function streamEntry(overrides: Partial<StreamEntry> = {}): StreamEntry {
  return {
    platform: "twitch",
    channel: "somechannel",
    url: "https://twitch.tv/somechannel",
    live: true,
    title: null,
    game_name: "Overwatch 2",
    viewer_count: null,
    thumbnail_url: null,
    started_at: null,
    player: null,
    ...overrides
  };
}

function participant(channel: string, viewerCount: number | null, name = channel): StreamEntry {
  return streamEntry({
    channel,
    url: `https://twitch.tv/${channel}`,
    viewer_count: viewerCount,
    player: { id: 1, name, avatar_url: null, team: null }
  });
}

function render(streams: TournamentStreams) {
  const root = createRoot(container);
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={en}>
        <TournamentBroadcastBlock streams={streams} />
      </NextIntlClientProvider>
    )
  );
  unmount = () => act(() => root.unmount());
}

/** The Twitch login currently in the frame, or `null` when nothing plays. */
function playingChannel(streams: TournamentStreams): string | null {
  render(streams);
  const src = container.querySelector("iframe")?.getAttribute("src");
  return src ? new URL(src).searchParams.get("channel") : null;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  unmount?.();
  unmount = null;
  container.remove();
});

describe("TournamentBroadcastBlock featured pick", () => {
  it("keeps a live official cast in the frame over a bigger participant", () => {
    expect(
      playingChannel({
        official: [streamEntry({ channel: "owtcast", viewer_count: 40 })],
        participants: [participant("bigstreamer", 9000)]
      })
    ).toBe("owtcast");
  });

  it("falls back to the busiest live participant when no official cast is live", () => {
    expect(
      playingChannel({
        official: [streamEntry({ channel: "owtcast", live: false })],
        participants: [participant("quietone", 3), participant("bigstreamer", 900)]
      })
    ).toBe("bigstreamer");
  });

  // A `null` count means the poller has not stamped one, not "more than zero".
  it("does not let an uncounted participant outrank a counted one", () => {
    expect(
      playingChannel({
        official: [streamEntry({ channel: "owtcast", live: false })],
        // `aaauncounted` sorts first alphabetically AND comes first in the
        // list, so only the viewer-count rule can keep it out of the frame.
        participants: [participant("aaauncounted", null), participant("zzzcounted", 0)]
      })
    ).toBe("zzzcounted");
  });

  it("picks the same participant on both orderings of a tie", () => {
    const official = [streamEntry({ channel: "owtcast", live: false })];
    const alpha = participant("alpha", 100);
    const bravo = participant("bravo", 100);

    const first = playingChannel({ official, participants: [alpha, bravo] });
    unmount?.();
    unmount = null;
    const second = playingChannel({ official, participants: [bravo, alpha] });

    expect(first).toBe(second);
  });

  it("still offers the link when nothing at all can be embedded", () => {
    render({
      official: [
        streamEntry({
          platform: "youtube",
          channel: "owtcast",
          url: "https://youtube.com/@owtcast",
          live: null
        })
      ],
      participants: [{ ...participant("offlineone", 10, "someplayer"), live: false }]
    });

    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).toContain(
      en.stream.broadcast.watchOn.replace("{platform}", "YouTube")
    );
  });
});

describe("TournamentBroadcastBlock fallback labelling", () => {
  const streams: TournamentStreams = {
    official: [
      streamEntry({
        channel: "owtcast",
        url: "https://twitch.tv/owtcast",
        live: false
      })
    ],
    participants: [
      streamEntry({
        channel: "somestreamer",
        url: "https://twitch.tv/somestreamer",
        viewer_count: 42,
        player: { id: 5, name: "someplayer", avatar_url: null, team: { id: 3, name: "Alpha" } }
      })
    ]
  };

  it("says whose POV the frame is, and never calls it the official broadcast", () => {
    render(streams);
    const text = container.textContent ?? "";

    expect(text).toContain(
      en.stream.broadcast.participantNoticeWithTeam
        .replace("{player}", "someplayer")
        .replace("{team}", "Alpha")
    );
    expect(text).toContain(en.stream.broadcast.participantHeading);
    expect(text).not.toContain(en.stream.broadcast.heading);
  });

  it("names the frame for assistive tech as a participant stream", () => {
    render(streams);

    expect(container.querySelector("iframe")?.getAttribute("title")).toBe(
      en.stream.broadcast.participantPlayerLabel.replace("{channel}", "somestreamer")
    );
  });

  // The official channel lost the frame, not its link: it is still the place a
  // spectator goes when the cast comes back.
  it("keeps every official link reachable", () => {
    render(streams);

    expect(container.querySelector('a[href="https://twitch.tv/owtcast"]')).not.toBeNull();
  });

  it("omits the team from the notice when there is no roster yet", () => {
    render({
      official: streams.official,
      participants: [participant("somestreamer", 42, "someplayer")]
    });

    expect(container.textContent).toContain(
      en.stream.broadcast.participantNotice.replace("{player}", "someplayer")
    );
  });
});
