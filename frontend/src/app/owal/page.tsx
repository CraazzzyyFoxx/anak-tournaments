import React from "react";
import tournamentService from "@/services/tournament.service";
import OwalStandingsTable from "@/app/owal/components/OwalStandingsTable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import OwalStacksTable from "./components/OwalStacksTable";


const OwalPage = async () => {
  const data = await tournamentService.getOwalStandings();
  const stacks = await tournamentService.getOwalStacks();

  return (
    <div>
      <Tabs defaultValue="standings">
        <TabsList className="grid grid-cols-2 w-[400px] mb-4">
          <TabsTrigger value="standings">Standings</TabsTrigger>
          <TabsTrigger value="stacks">Stacks</TabsTrigger>
        </TabsList>
        <TabsContent value="standings">
          <OwalStandingsTable data={data} />
        </TabsContent>
        <TabsContent value="stacks">
          <OwalStacksTable data={stacks} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default OwalPage;
