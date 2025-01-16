import React from "react";
import encounterService from "@/services/encounter.service";
import EncounterTeamCard from "@/app/encounters/[id]/components/EncounterTeamCard";
import EncounterHeader from "@/app/encounters/[id]/components/EncounterHeader";
import EncounterMatchesCard from "@/app/encounters/[id]/components/EncounterMatchesCard";
import { Metadata } from "next";

export async function generateMetadata(props: {
  params: Promise<{ id: number }>;
}): Promise<Metadata> {
  const params = await props.params;
  const encounter = await encounterService.getEncounter(params.id);

  return {
    title: `${encounter.home_team.name} vs ${encounter.away_team.name} | AQT`,
    description: `Overview for ${encounter.home_team.name} vs ${encounter.away_team.name} on AQT.`,
    openGraph: {
      title: `${encounter.home_team.name} vs ${encounter.away_team.name} | AQT`,
      description: `Overview for ${encounter.home_team.name} vs ${encounter.away_team.name} on AQT.`,
      url: "https://aqt.craazzzyyfoxx.me",
      type: "website",
      siteName: "AQT",
      locale: "en_US"
    }
  };
}

const EncounterPage = async (props: { params: Promise<{ id: number }> }) => {
  const params = await props.params;
  const encounter = await encounterService.getEncounter(params.id);

  return (
    <div>
      <EncounterHeader encounter={encounter} />
      <div className="py-8 grid xs:grid-cols-1 xl:grid-cols-3 gap-8">
        <EncounterTeamCard team={encounter.home_team} isHome={true} />
        <EncounterMatchesCard encounter={encounter} />
        <EncounterTeamCard team={encounter.away_team} isHome={false} />
      </div>
    </div>
  );
};

export default EncounterPage;
