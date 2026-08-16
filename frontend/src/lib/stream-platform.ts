import type { StreamPlatform } from "@/types/stream.types";

/**
 * Platform detection + live-status presentation for stream entries.
 *
 * The backend already stamps `platform` on every entry; these helpers exist for
 * the cases where only a raw URL is in hand (an official `tournament_link` read
 * straight off the tournament, an admin form preview) and for keeping the
 * live/offline/unknown presentation in ONE registry.
 */

/**
 * Platform of a stream URL, by host. Unparseable or unknown hosts are `"other"`
 * rather than an error — a link the organiser typed is still worth rendering.
 */
export function detectStreamPlatform(url: string): StreamPlatform {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "other";
  }
  if (hostname === "twitch.tv" || hostname.endsWith(".twitch.tv")) {
    return "twitch";
  }
  if (
    hostname === "youtube.com" ||
    hostname.endsWith(".youtube.com") ||
    hostname === "youtu.be"
  ) {
    return "youtube";
  }
  return "other";
}

/**
 * Twitch login out of a channel URL, lowercased (Twitch logins are lowercase).
 * `null` for anything that is not a `twitch.tv/<login>` page — including the
 * ones that look like a channel but are not (`/videos/…`, `/directory/…`).
 */
export function extractTwitchChannel(url: string): string | null {
  if (detectStreamPlatform(url) !== "twitch") {
    return null;
  }
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const [first, ...rest] = pathname.split("/").filter(Boolean);
  // A channel page is exactly one segment. `/videos/123`, `/directory/game/x`
  // and `/<login>/clip/…` are not channels.
  if (!first || rest.length > 0) {
    return null;
  }
  const login = first.toLowerCase();
  return /^[a-z0-9_]{3,25}$/.test(login) ? login : null;
}

/**
 * Which of the three presentation buckets a `StreamEntry.live` value falls
 * into. `null` is its own bucket: the platform has no live detection, so the
 * state is UNKNOWN, not offline.
 */
export type StreamStatus = "live" | "offline" | "unknown";

/**
 * Typed as a union rather than `string` because `next-intl` messages are
 * strictly typed (`src/global.d.ts`) and `t()` rejects a widened key.
 */
type StreamStatusLabelKey = "stream.status.live" | "stream.status.offline";

type StreamStatusMeta = {
  /**
   * Pill copy, or `null` for NO pill at all. `unknown` renders nothing — a grey
   * "offline" badge on a YouTube link would assert a fact we do not have. The
   * rule lives here once instead of as a `live === null` ternary at each call
   * site, same reasoning as `TOURNAMENT_STATUS_META`.
   */
  labelKey: StreamStatusLabelKey | null;
  /** `.status-pill.{variant}` class from `globals.css` (scoped by `.aqt-tn`). */
  pillClassName: string;
  /** Whether the pill carries the animated `.dot`. */
  hasDot: boolean;
  /** Whether the player may be embedded for this state. */
  embeddable: boolean;
};

export const STREAM_STATUS_META: Record<StreamStatus, StreamStatusMeta> = {
  live: {
    labelKey: "stream.status.live",
    pillClassName: "status-pill live",
    hasDot: true,
    embeddable: true,
  },
  offline: {
    labelKey: "stream.status.offline",
    pillClassName: "status-pill finished",
    hasDot: false,
    embeddable: false,
  },
  unknown: {
    labelKey: null,
    pillClassName: "",
    hasDot: false,
    embeddable: false,
  },
};

export function getStreamStatus(live: boolean | null): StreamStatus {
  if (live === null) {
    return "unknown";
  }
  return live ? "live" : "offline";
}

