import { Suspense } from "react";

import { loadGameScopeInit } from "@/lib/site/discipline-server";
import { resolveStatsScope } from "@/lib/site/tenant-host";

import UsersClient from "./components/index/UsersClient";

const UsersPage = async () => {
  const [scope, initial] = await Promise.all([resolveStatsScope(), loadGameScopeInit()]);

  return (
    <Suspense fallback={null}>
      <UsersClient scope={scope} initial={initial} />
    </Suspense>
  );
};

export default UsersPage;
