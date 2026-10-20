import { loadGameScopeInit } from "@/lib/site/discipline-server";
import { resolveStatsScope } from "@/lib/site/tenant-host";

import CompareClient from "./components/CompareClient";

const UserComparePage = async () => {
  const [scope, initial] = await Promise.all([resolveStatsScope(), loadGameScopeInit()]);
  return <CompareClient scope={scope} initial={initial} />;
};

export default UserComparePage;
