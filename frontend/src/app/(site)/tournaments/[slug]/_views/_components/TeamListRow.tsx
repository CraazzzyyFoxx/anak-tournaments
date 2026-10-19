"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, Crown } from "lucide-react";
import { useTranslations } from "next-intl";
import type { RoleOntology } from "@/lib/roster/ontology";
import { useFormatter } from "@/lib/datetime/client";

import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { TeamPlacement, TournamentTeamTable } from "@/components/TournamentTeamCard";
import TeamName from "@/components/TeamName";
import { sortTeamPlayers } from "@/lib/player";
import { groupDisplayName, groupHue } from "@/lib/tournament/group";
import { cn } from "@/lib/utils";
import type { CatalogEntityChip } from "@/types/catalog.types";
import type { Registration } from "@/types/registration.types";
import type { Team } from "@/types/team.types";
import type { Tournament } from "@/types/tournament.types";

import { declaredHeroes, MARK_CLASS, type TeamRecord } from "../tournamentTeams.model";
import { overviewVariant } from "../tournamentOverview.model";

/**
 * One team as a collapsed team card that unfolds the card's own roster table.
 * `<details>` and not per-row state, so several teams stay open at once and the
 * browser keeps them open across a re-render.
 *
 * `showGroup`: the visible rows span several groups, so the group colour tells
 * them apart; otherwise the chip would repeat one value on every row.
 */
export const TeamListRow = ({
  team,
  tournament,
  slug,
  record,
  needle,
  showGroup,
  registrationsByUser,
  heroesMap,
  ontology
}: {
  team: Team;
  tournament: Tournament;
  slug: string;
  record: TeamRecord | null | undefined;
  needle: string;
  showGroup: boolean;
  registrationsByUser: Map<number, Registration>;
  heroesMap: Map<string, CatalogEntityChip>;
  /** The tournament's own game's scoped ontology; `null` while it loads. */
  ontology: RoleOntology | null;
}) => {
  const t = useTranslations();
  const format = useFormatter();
  // A live leader is not on the podium yet: `placement` moves with every result.
  const medal = overviewVariant(tournament.status) === "completed";
  const players = sortTeamPlayers(team.players);
  const roster = team.players.map((player) => ({
    ...player,
    heroes: declaredHeroes(player, registrationsByUser.get(player.user_id), heroesMap)
  }));

  return (
    <details className="team-card group">
      <summary className="cursor-pointer list-none rounded-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--aqt-teal)] [&::-webkit-details-marker]:hidden">
        <div className="tc-header grid grid-cols-[2.75rem_minmax(0,1fr)_auto_1rem] items-center gap-2.5 sm:grid-cols-[2.75rem_minmax(0,1fr)_auto_auto_1rem] sm:gap-5">
          <span>
            {team.placement != null ? (
              <TeamPlacement placement={team.placement} medal={medal} />
            ) : null}
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <span className="flex min-w-0 items-center gap-2">
              <span className="tc-name">
                <TeamName team={team} size="sm" />
              </span>
              {/* Wrapped: `.group-chip` sets its own display, which would
                  outrank a `hidden` utility on the chip itself. */}
              {showGroup && team.group?.name ? (
                <span className="hidden shrink-0 sm:inline-flex">
                  <span
                    className="group-chip"
                    style={{ "--group-hue": groupHue(team.group.name) } as CSSProperties}
                  >
                    {groupDisplayName(team.group.name, t("common.group"))}
                  </span>
                </span>
              ) : null}
            </span>
            {/* The roster at a glance: role glyph + nick, captain crowned. A
                searched battletag shows in full, marked. */}
            <span className="truncate text-caption text-[color:var(--aqt-fg-muted)]">
              {players.map((player) => {
                const matched = needle !== "" && player.name.toLowerCase().includes(needle);
                return (
                  <span
                    key={player.id}
                    className={cn("mr-3 last:mr-0", player.is_substitution && "opacity-60")}
                  >
                    {/* Inline, not flex: an atomic box is clipped whole, so
                        `truncate` could only ellipsize plain text runs. */}
                    <span className="mr-1 inline-block align-[-2px]">
                      <PlayerRoleIcon role={player.role} ontology={ontology} size={13} decorative />
                    </span>
                    {matched ? (
                      <mark className={MARK_CLASS}>{player.name}</mark>
                    ) : (
                      player.name.split("#")[0]
                    )}
                    {player.user_id === team.captain_id ? (
                      <Crown
                        aria-hidden
                        className="ml-1 inline-block size-3 align-[-1px] text-[color:var(--aqt-amber)]"
                      />
                    ) : null}
                  </span>
                );
              })}
            </span>
          </span>
          {/* Below `sm` the name needs the width; the expanded roster still
              carries every rank. */}
          <span className="tc-sr hidden sm:block">
            <span className="l block">{t("teams.roster.avgSr")}</span>
            <span className="v block">
              {format.number(team.avg_sr, { maximumFractionDigits: 0 })}
            </span>
          </span>
          <span className="tc-sr min-w-[2.5rem]">
            <span className="l block">{t("tournamentDetail.teams.record")}</span>
            <span className="v block">{record ? `${record.won}–${record.lost}` : "—"}</span>
          </span>
          <ChevronDown
            className="size-4 text-[color:var(--aqt-fg-faint)] transition-transform group-open:rotate-180"
            aria-hidden
          />
        </div>
      </summary>
      <div className="tc-divider" />
      <TournamentTeamTable
        players={roster}
        tournamentGrid={tournament.division_grid_version}
        discipline={tournament.discipline}
        ontology={ontology}
        captainUserId={team.captain_id}
      />
      <div className="tc-divider" />
      <div className="px-3.5 py-2.5 text-label">
        <Link
          href={`/tournaments/${slug}/matches?team=${team.id}`}
          className="inline-flex items-center gap-1 text-[color:var(--aqt-fg-muted)] transition-colors hover:text-[color:var(--aqt-teal)]"
        >
          {t("tournamentDetail.teams.teamMatches")}
          <ArrowRight aria-hidden className="size-3" />
        </Link>
      </div>
    </details>
  );
};
