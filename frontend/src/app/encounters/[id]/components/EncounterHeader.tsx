import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Swords } from "lucide-react";
import { Encounter } from "@/types/encounter.types";

const EncounterHeader = ({ encounter }: { encounter: Encounter }) => {
  let name = `${encounter.tournament.number}`;
  if (encounter.tournament.is_league) {
    name = encounter.tournament.name;
  }

  return (
    <Card>
      <CardContent className="flex flex-row gap-8 p-4">
        <div className="flex flex-row gap-4 items-center">
          <Swords height={40} width={40} />
          <div className="flex flex-col">
            <p className="leading-7 ">Tournament</p>
            <h4 className="scroll-m-20 text-xl font-semibold tracking-tight">{name}</h4>
          </div>
          <div className="flex flex-col">
            <p className="leading-7 ">Group</p>
            <h4 className="scroll-m-20 text-xl font-semibold tracking-tight">
              {encounter.tournament_group.name}
            </h4>
          </div>
        </div>
        {/*<div className="flex flex-row gap-4">*/}
        {/*  <div className="flex flex-col text-right">*/}
        {/*    <p className="leading-7 text-[#16e5b4]">{encounter.home_team.name}</p>*/}
        {/*    <h4 className="scroll-m-20 text-xl font-semibold tracking-tight text-[#16e5b4]">*/}
        {/*      {encounter.score.home}*/}
        {/*    </h4>*/}
        {/*  </div>*/}
        {/*  <div className="flex items-end">*/}
        {/*    <h4 className="scroll-m-20 text-xl font-semibold tracking-tight">:</h4>*/}
        {/*  </div>*/}
        {/*  <div className="flex flex-col text-left">*/}
        {/*    <p className="leading-7  text-[#ff4655]">{encounter.away_team.name}</p>*/}
        {/*    <h4 className="scroll-m-20 text-xl font-semibold tracking-tight text-[#ff4655]">*/}
        {/*      {encounter.score.away}*/}
        {/*    </h4>*/}
        {/*  </div>*/}
        {/*</div>*/}
      </CardContent>
    </Card>
  );
};

export default EncounterHeader;
