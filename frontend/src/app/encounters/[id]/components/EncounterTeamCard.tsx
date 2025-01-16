import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EncounterTeamPlayersTable from "@/app/encounters/[id]/components/EncounterTeamPlayersTable";
import { Team } from "@/types/team.types";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

const EncounterTeamCard = ({ team, isHome }: { team: Team; isHome: boolean }) => {
  const titleColor = isHome ? "text-[#16e5b4]" : "text-[#ff4655]";

  return (
    <Card>
      <CardHeader className="px-0 pl-4">
        <CardTitle className={`scroll-m-20 text-2xl font-semibold tracking-tight ${titleColor}`}>
          {team.name}
        </CardTitle>
        <p className={`leading-7 ${titleColor}`}>
          Placement: {team.placement ? team.placement : "Unknown"}
        </p>
      </CardHeader>
      <ScrollArea>
        <EncounterTeamPlayersTable team={team} isHome={isHome} />
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </Card>
  );
};

export default EncounterTeamCard;
