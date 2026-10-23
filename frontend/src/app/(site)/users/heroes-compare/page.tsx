import { Suspense } from "react";

import { loadGameScopeInit } from "@/lib/site/discipline-server";
import { resolveStatsScope } from "@/lib/site/tenant-host";

import HeroLeaderboardContent from "./components/HeroLeaderboardContent";

const HeroesComparePage = async () => {
  const [scope, initial] = await Promise.all([resolveStatsScope(), loadGameScopeInit()]);

  return (
    <Suspense fallback={null}>
      <HeroLeaderboardContent scope={scope} initial={initial} />
    </Suspense>
  );
};

export default HeroesComparePage;
