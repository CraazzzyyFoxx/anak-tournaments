import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { getPlayerSlug, getPlayerType } from "@/lib/player";
import type { RoleRef } from "@/lib/roster/role-ref";

/**
 * Minimal player-like shape accepted by `PlayerName`. Compatible with
 * `Player`, `User`, and `TeamRosterPlayer` / `UserTournamentPlayer`.
 */
interface PlayerNameInput {
  name: string;
  role?: RoleRef | null;
}

const PlayerName = ({
  player,
  includeSpecialization,
  excludeBadge,
  profileName
}: {
  player: PlayerNameInput;
  includeSpecialization: boolean;
  excludeBadge?: boolean;
  /**
   * The name the profile link is built from. Omitted: `player.name` (a roster or user row, whose name is the
   * player's own). A parsed observation's `name` is only the handle its log recorded, so it passes the player's
   * canonical name here — or `null` when it has none, which leaves the handle unlinked.
   */
  profileName?: string | null;
}) => {
  const name = player.name.split("#")[0];
  const tag = player.name.split("#")[1];
  const playerRoleInfo =
    "role" in player && player.role !== undefined
      ? { role: player.role ?? null }
      : null;

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex min-w-0 flex-row items-center gap-1">
        {profileName === undefined || profileName ? (
          <Link href={`/users/${getPlayerSlug(profileName ?? player.name)}`} className="min-w-0">
            <span className="block truncate text-base font-semibold" title={name}>
              {name}
            </span>
          </Link>
        ) : (
          <span className="block min-w-0 truncate text-base font-semibold" title={name}>
            {name}
          </span>
        )}
        {tag && !excludeBadge && (
          <Badge variant="secondary" className="shrink-0 px-1 text-xs">
            <p className="text-muted-foreground">{`#${tag}`}</p>
          </Badge>
        )}
      </div>
      <div>
        {includeSpecialization && playerRoleInfo && (
          <p className="text-xs text-muted-foreground">{getPlayerType(playerRoleInfo)}</p>
        )}
      </div>
    </div>
  );
};

export default PlayerName;
