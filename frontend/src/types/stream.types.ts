/**
 * Tournament stream + link shapes.
 *
 * There is no OpenAPI type generation in this project — `src/types/*.types.ts`
 * are written by hand and kept in sync with the backend by eye. These mirror
 * `stream-service`'s `rpc.stream.tournament_streams` response and
 * `tournament.tournament_link`.
 */

export type StreamPlatform = "twitch" | "youtube" | "other";

/** The player behind a participant stream. `null` for an official broadcast. */
export interface StreamStreamer {
  id: number;
  name: string;
  avatar_url: string | null;
}

export interface StreamEntry {
  platform: StreamPlatform;
  /** Twitch login, or a human-readable channel identifier on other platforms. */
  channel: string;
  url: string;
  /**
   * Tri-state on purpose.
   *
   * `true`/`false` — the poller has live detection for this platform (Twitch)
   * and reports the current state. `null` — there IS no live detection for the
   * platform (YouTube/other), so liveness is UNKNOWN. `null` is NOT `false`:
   * an unknown channel must not render an "offline" badge, it renders no badge
   * at all (see `STREAM_STATUS_META` in `@/lib/stream-platform`).
   */
  live: boolean | null;
  title: string | null;
  game_name: string | null;
  viewer_count: number | null;
  /** Already sized (440x248) by the backend — no `{width}x{height}` placeholders. */
  thumbnail_url: string | null;
  /** ISO8601. */
  started_at: string | null;
  player: StreamStreamer | null;
}

export interface TournamentStreams {
  /**
   * Official broadcast links, live or not — the link itself is always worth
   * showing.
   */
  official: StreamEntry[];
  /** Participant streams — only the ones currently live. */
  participants: StreamEntry[];
}

/** Mirrors `TOURNAMENT_LINK_KINDS` in `backend/shared/models/tournament/link.py`. */
export type TournamentLinkKind =
  | "discord"
  | "stream"
  | "vod"
  | "bracket"
  | "rules"
  | "other";

export interface TournamentLink {
  id: number;
  tournament_id: number;
  kind: TournamentLinkKind;
  label: string | null;
  url: string;
  sort_order: number;
  is_active: boolean;
}

/**
 * Create/update payloads of `/api/v1/admin/tournament-links`.
 *
 * `id` is server-assigned and `tournament_id` is immutable once created, so the
 * update payload is a partial of the editable columns only.
 */
export interface TournamentLinkCreateInput {
  tournament_id: number;
  kind: TournamentLinkKind;
  label?: string | null;
  url: string;
  sort_order?: number;
}

export type TournamentLinkUpdateInput = Partial<
  Pick<TournamentLink, "kind" | "label" | "url" | "sort_order" | "is_active">
>;
