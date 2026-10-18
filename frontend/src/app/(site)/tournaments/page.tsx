import { loadBrowsingDisciplineInit } from "@/lib/site/discipline-server";
import { resolveStatsScope } from "@/lib/site/tenant-host";

import TournamentsClient from "./components/TournamentsClient";

const TournamentsPage = async () => (
  <TournamentsClient scope={await resolveStatsScope()} initial={await loadBrowsingDisciplineInit()} />
);

export default TournamentsPage;
