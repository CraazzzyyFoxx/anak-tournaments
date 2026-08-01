import React from "react";
import { useTranslations } from "next-intl";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Team } from "@/types/team.types";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { CircleMinus, CirclePlus, Recycle } from "lucide-react";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import PlayerName from "@/components/PlayerName";
import DivisionIcon from "@/components/DivisionIcon";
import { sortTeamPlayers } from "@/utils/player";
import type { DivisionGridVersion } from "@/types/workspace.types";

const EncounterTeamCard = ({
  team,
  isHome,
  tournamentGrid,
}: {
  team: Team;
  isHome: boolean;
  tournamentGrid?: DivisionGridVersion | null;
}) => {
  const t = useTranslations();
  const titleColor = isHome ? "text-[color:var(--aqt-teal)]" : "text-[color:var(--aqt-rose)]";
  const sortedPlayers = sortTeamPlayers(team.players);
  // Derived from the same side token the title uses, instead of the two invented
  // hex values (#104e48 / #4c2332) that used to sit beside it.
  const sideAccent = isHome ? "var(--aqt-teal)" : "var(--aqt-rose)";
  const headerBackground = `color-mix(in srgb, ${sideAccent} 22%, var(--aqt-card))`;

  return (
    <Card>
      <CardHeader className="px-0 pl-4">
        <CardTitle className={`scroll-m-20 text-2xl font-semibold tracking-tight ${titleColor}`}>
          {team.name}
        </CardTitle>
        <p className={`leading-7 ${titleColor}`}>
          {t("encounters.team.placement", {
            value: team.placement ? String(team.placement) : t("common.unknown")
          })}
        </p>
      </CardHeader>
      <ScrollArea>
        <Table>
          <TableHeader>
            <TableRow style={{ backgroundColor: headerBackground }}>
              <TableHead scope="col">{t("encounters.team.colName")}</TableHead>
              <TableHead scope="col" className="text-center">
                {t("encounters.team.colDivision")}
              </TableHead>
              <TableHead scope="col" className="text-center">
                {t("encounters.team.colNew")}
              </TableHead>
              <TableHead scope="col" className="text-center">
                {t("encounters.team.colNewRole")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedPlayers.map((player, index) => (
              <TableRow key={player.id} className="hover:bg-background">
                <TableCell
                  className={`flex flex-row items-center gap-2 ${index === sortedPlayers.length - 1 ? "rounded-b-lg" : ""}`}
                  style={{
                    background: `linear-gradient(to right, color-mix(in srgb, ${sideAccent} 20%, var(--aqt-card)), var(--aqt-card) 60%)`
                  }}
                >
                  <div className="flex flex-row items-center gap-2">
                    {player.is_substitution ? (
                      <Recycle aria-label={t("encounters.team.substitution")} />
                    ) : (
                      <PlayerRoleIcon role={player.role} />
                    )}
                    <PlayerName player={player} includeSpecialization={true} />
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex justify-center">
                    <DivisionIcon
                      division={player.division}
                      width={32}
                      height={32}
                      tournamentGrid={tournamentGrid}
                    />
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex justify-center">
                    {player.is_newcomer ? (
                      <CirclePlus className="text-[color:var(--aqt-amber)]" />
                    ) : (
                      <CircleMinus className="text-[color:var(--aqt-fg-faint)]" />
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex justify-center">
                    {player.is_newcomer_role ? (
                      <CirclePlus className="text-[color:var(--aqt-amber)]" />
                    ) : (
                      <CircleMinus className="text-[color:var(--aqt-fg-faint)]" />
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </Card>
  );
};

export default EncounterTeamCard;
