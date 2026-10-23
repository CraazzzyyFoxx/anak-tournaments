import { useMinuteClock } from "@/hooks/useMinuteClock";
import type { MixLobbyState } from "@/services/custom-game.service";

/**
 * Whole minutes since a lobby's match started -- its bans (Pre-game) included -- or since its running draft's first
 * pick went on the clock, re-read once a minute; `null` while neither runs (or before the clock hydrates). There is no
 * automatic timeout, so this is how a host notices a match nobody recorded.
 */
export function useLiveMinutes(
  state: MixLobbyState,
  startedAt: string | null | undefined
): number | null {
  const now = useMinuteClock();
  return (state === "live" || state === "pregame" || state === "draft_live") && startedAt != null && now != null
    ? Math.max(0, Math.floor((now - Date.parse(startedAt)) / 60_000))
    : null;
}
