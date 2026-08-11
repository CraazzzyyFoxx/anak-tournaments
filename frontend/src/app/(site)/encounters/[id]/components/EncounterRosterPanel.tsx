import React from "react";
import { useTranslations } from "next-intl";
import { CircleMinus, CirclePlus, Crown, Repeat2 } from "lucide-react";

import { cn } from "@/lib/utils";
import DivisionIcon from "@/components/DivisionIcon";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import type { Team } from "@/types/team.types";
import type { DivisionGridVersion } from "@/types/workspace.types";
import { sortTeamPlayers } from "@/utils/player";
import type { SeriesSide } from "../encounter-detail.helpers";
import { PillFact, PlayerIdentity } from "./EncounterAtoms";
import styles from "../EncounterDetail.module.css";

/**
 * One side's roster.
 *
 * Everything the old `EncounterTeamCard` showed is here — role, name,
 * specialization, division, newcomer and new-to-role flags, substitute marker,
 * placement — plus the fields that were already on the wire and rendered
 * nowhere: the player's SR, the team's average and total SR, the roster size,
 * and who the captain is. Substitutes are indented under the player they came
 * in for, so the substitution chain `sortTeamPlayers` builds is finally visible.
 */
export default function EncounterRosterPanel({
  team,
  side,
  tournamentGrid
}: {
  team: Team | null;
  side: SeriesSide;
  tournamentGrid?: DivisionGridVersion | null;
}) {
  const t = useTranslations();
  const players = sortTeamPlayers(team?.players ?? []);
  const captainId = team?.captain_id ?? null;

  return (
    // A plain container, not a `region`: the visible <h3> already names the
    // panel, and one landmark per card would flood the rotor.
    <div className={cn(styles.card, side === "home" ? styles.sideHome : styles.sideAway)}>
      <div className={styles.rosterHead}>
        <h3 className={styles.rosterName}>{team?.name ?? t("common.tbd")}</h3>
        <div className={styles.rosterFacts}>
          <PillFact label={t("common.playersLabel")} value={players.length} />
          {team && Number.isFinite(team.avg_sr) && team.avg_sr > 0 ? (
            <PillFact label={t("encounters.team.avgSr")} value={Math.round(team.avg_sr)} />
          ) : null}
          {team && Number.isFinite(team.total_sr) && team.total_sr > 0 ? (
            <PillFact label={t("encounters.team.totalSr")} value={team.total_sr.toLocaleString()} />
          ) : null}
        </div>
      </div>

      {players.length === 0 ? (
        <p className={cn(styles.cardBody, styles.statsNotice)}>{t("common.noData")}</p>
      ) : (
        <div
          className={styles.rosterScroll}
          tabIndex={0}
          role="group"
          aria-label={t("encounters.detail.rosterAria", {
            team: team?.name ?? t("common.tbd")
          })}
        >
          <div className={styles.rosterTable} role="table">
            <div className={cn(styles.rosterRow, styles.rosterHeadRow)} role="row">
              <span className={styles.rosterHeadCell} role="columnheader">
                {t("encounters.team.colName")}
              </span>
              <span
                className={cn(styles.rosterHeadCell, styles.rosterCell)}
                role="columnheader"
                aria-label={t("encounters.team.colDivision")}
              >
                {t("encounters.team.colDivisionShort")}
              </span>
              <span
                className={cn(styles.rosterHeadCell, styles.rosterSr)}
                role="columnheader"
                title={t("encounters.team.colSrTitle")}
              >
                {t("encounters.team.colSr")}
              </span>
              <span
                className={cn(styles.rosterHeadCell, styles.rosterCell)}
                role="columnheader"
                aria-label={t("encounters.team.colNew")}
                title={t("encounters.team.colNewTitle")}
              >
                {t("encounters.team.colNewShort")}
              </span>
              <span
                className={cn(styles.rosterHeadCell, styles.rosterCell)}
                role="columnheader"
                aria-label={t("encounters.team.colNewRole")}
                title={t("encounters.team.colNewRoleTitle")}
              >
                {t("encounters.team.colNewRoleShort")}
              </span>
            </div>

            {players.map((player) => {
              const isCaptain = captainId != null && player.user_id === captainId;
              return (
                <div
                  key={player.id}
                  role="row"
                  className={cn(
                    styles.rosterRow,
                    styles.rosterBodyRow,
                    player.is_substitution && styles.rosterRowSub
                  )}
                >
                  <span className={styles.rosterPlayer} role="cell">
                    <PlayerRoleIcon role={player.role} size={18} />
                    <PlayerIdentity player={player} />
                    {isCaptain ? (
                      <Crown
                        className={styles.captainMark}
                        width={14}
                        height={14}
                        aria-label={t("encounters.team.captain")}
                      />
                    ) : null}
                    {player.is_substitution ? (
                      <Repeat2
                        className={styles.flagOff}
                        width={14}
                        height={14}
                        aria-label={t("encounters.team.substitution")}
                      />
                    ) : null}
                  </span>
                  <span className={styles.rosterCell} role="cell">
                    <DivisionIcon
                      division={player.division}
                      width={28}
                      height={28}
                      tournamentGrid={tournamentGrid}
                    />
                  </span>
                  <span className={cn(styles.rosterSr, styles.mono)} role="cell">
                    {player.rank > 0 ? player.rank.toLocaleString() : "—"}
                  </span>
                  <span className={styles.rosterCell} role="cell">
                    <Flag
                      on={player.is_newcomer}
                      onLabel={t("encounters.team.newcomerYes")}
                      offLabel={t("encounters.team.newcomerNo")}
                    />
                  </span>
                  <span className={styles.rosterCell} role="cell">
                    <Flag
                      on={player.is_newcomer_role}
                      onLabel={t("encounters.team.newRoleYes")}
                      offLabel={t("encounters.team.newRoleNo")}
                    />
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Flag({ on, onLabel, offLabel }: { on: boolean; onLabel: string; offLabel: string }) {
  const Icon = on ? CirclePlus : CircleMinus;
  return (
    <Icon
      width={17}
      height={17}
      className={on ? styles.flagOn : styles.flagOff}
      aria-label={on ? onLabel : offLabel}
    />
  );
}
