import React from "react";
import tournamentService from "@/services/tournament.service";
import OwalStandingsTable from "@/app/owal/components/OwalStandingsTable";

const OwalPage = async () => {
  const data = await tournamentService.getOwalStandings();

  return (
    <div>
      <OwalStandingsTable data={data} />
    </div>
  );
};

export default OwalPage;
