"use client";

import type { StatsScope } from "@/lib/site/stats-scope";

import { useUsersIndexParams } from "./useUsersIndexParams";
import { useUsersIndexData } from "./useUsersIndexData";
import { UsersIndexHero } from "./UsersIndexHero";
import { UsersIndexFilters } from "./UsersIndexFilters";
import { UsersTableView } from "./UsersTableView";
import { UsersCatalogView } from "./UsersCatalogView";
import { UsersCompareBar, useCompareSelection } from "./UsersCompareBar";

/**
 * The player index. Both views share one set of URL-backed filters; only the
 * one on screen fetches its own list, and the compare selection survives a
 * switch between them.
 *
 * `scope` is resolved on the server (the cross-workspace mode does not exist
 * on a tenant host).
 */
const UsersClient = ({ scope }: Readonly<{ scope: StatsScope }>) => {
  const controls = useUsersIndexParams(scope);
  const data = useUsersIndexData(controls.params);
  const compare = useCompareSelection();
  const { view } = controls.params;

  return (
    // Bottom padding leaves room for the fixed compare bar.
    <div className="space-y-4 pb-24">
      <UsersIndexHero stats={data.statsQuery.data} />
      <UsersIndexFilters
        controls={controls}
        stats={data.statsQuery.data}
        // `null` means "we could not load it", which is not a count of zero and
        // not a load that is still running.
        foundCount={
          view === "catalog"
            ? data.catalogQuery.isError
              ? null
              : data.catalogQuery.data?.total
            : data.overviewQuery.isError
              ? null
              : data.overviewQuery.data?.total
        }
      />

      {view === "catalog" ? (
        <UsersCatalogView controls={controls} data={data} compare={compare} />
      ) : (
        <UsersTableView controls={controls} data={data} compare={compare} />
      )}

      <UsersCompareBar compare={compare} />
    </div>
  );
};

export default UsersClient;
