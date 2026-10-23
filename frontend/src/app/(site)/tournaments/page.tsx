import { loadGameScopeInit } from "@/lib/site/discipline-server";
import { resolveStatsScope } from "@/lib/site/tenant-host";

import TournamentsClient from "./components/TournamentsClient";

const TournamentsPage = async () => {
  const [scope, initial] = await Promise.all([resolveStatsScope(), loadGameScopeInit()]);
  return <TournamentsClient scope={scope} initial={initial} />;
};

export default TournamentsPage;
