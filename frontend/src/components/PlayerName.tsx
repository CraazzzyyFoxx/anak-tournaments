import { HandleLabel } from "@/components/HandleLabel";
import { HoverPrefetchLink } from "@/components/HoverPrefetchLink";
import { getPlayerSlug, getPlayerType } from "@/lib/player";
import type { RoleRef } from "@/lib/roster/role-ref";
import { cn } from "@/lib/utils";

/**
 * Minimal player-like shape accepted by `PlayerName`. Compatible with
 * `Player`, `User`, and `TeamRosterPlayer` / `UserTournamentPlayer`.
 */
interface PlayerNameInput {
  name: string;
  role?: RoleRef | null;
}

/**
 * A player's handle (`HandleLabel`: the name, a faint `#tag`) linking to their
 * profile, with their role under it on request. One block that truncates:
 * `className` sets its width (`max-w-…`) or the name's size.
 */
const PlayerName = ({
  player,
  includeSpecialization = false,
  profileName,
  className
}: {
  player: PlayerNameInput;
  includeSpecialization?: boolean;
  /**
   * The name the profile link is built from. Omitted: `player.name` (a roster or user row, whose name is the
   * player's own). A parsed observation's `name` is only the handle its log recorded, so it passes the player's
   * canonical name here — or `null` when it has none, which leaves the handle unlinked.
   */
  profileName?: string | null;
  className?: string;
}) => {
  const linkName = profileName === undefined ? player.name : profileName;
  const playerRoleInfo =
    "role" in player && player.role !== undefined
      ? { role: player.role ?? null }
      : null;

  return (
    <div className={cn("min-w-0 text-base", className)}>
      {linkName ? (
        // Hover/focus prefetch: a roster or a player index renders dozens of these at once.
        <HoverPrefetchLink
          href={`/users/${getPlayerSlug(linkName)}`}
          title={player.name}
          className="block min-w-0 transition-colors hover:text-[color:var(--aqt-teal)]"
        >
          <HandleLabel handle={player.name} className="block font-semibold" />
        </HoverPrefetchLink>
      ) : (
        <HandleLabel handle={player.name} title={player.name} className="block font-semibold" />
      )}
      {includeSpecialization && playerRoleInfo && (
        <p className="text-xs text-muted-foreground">{getPlayerType(playerRoleInfo)}</p>
      )}
    </div>
  );
};

export default PlayerName;
