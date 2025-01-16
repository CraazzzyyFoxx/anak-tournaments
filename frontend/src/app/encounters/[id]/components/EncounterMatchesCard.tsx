import React from "react";
import { Encounter } from "@/types/encounter.types";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import EncounterMatch from "@/app/encounters/[id]/components/EncounterMatch";

const EncounterMatchesCard = ({ encounter }: { encounter: Encounter }) => {
  return (
    <Card>
      <CardHeader>
        <div className="flex gap-4">
          <div className="flex-1 text-right">
            <p className="scroll-m-20 text-2xl font-semibold tracking-tight text-[#16e5b4]">
              {encounter.score.home > encounter.score.away ? "Winner" : "Loser"}
            </p>
            <h4 className="scroll-m-20 text-xl font-semibold tracking-tight text-[#16e5b4]">
              {encounter.score.home}
            </h4>
          </div>
          <div className="flex items-end">
            <h4 className="scroll-m-20 text-xl font-semibold tracking-tight">:</h4>
          </div>
          <div className="flex-1 text-left">
            <p className="scroll-m-20 text-2xl font-semibold tracking-tight text-[#ff4655]">
              {encounter.score.home < encounter.score.away ? "Winner" : "Loser"}
            </p>
            <h4 className="scroll-m-20 text-xl font-semibold tracking-tight text-[#ff4655]">
              {encounter.score.away}
            </h4>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid xs:grid-cols-1 xs1:grid-cols-2 md:grid-cols-3 xl:grid-cols-2 gap-4">
        {encounter.matches.map((match) => (
          <EncounterMatch key={match.id} match={match} />
        ))}
      </CardContent>
    </Card>
  );
};

export default EncounterMatchesCard;
