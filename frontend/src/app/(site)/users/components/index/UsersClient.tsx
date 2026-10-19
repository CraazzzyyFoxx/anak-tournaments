"use client";

import { isDivisionGridRequired, MissingGridNotice } from "@/components/divisions/MissingGridNotice";
import { DisciplineSelector, DisciplineUnavailable } from "@/components/workspace/DisciplineSelector";
import { useBrowsingDiscipline } from "@/hooks/useBrowsingDiscipline";
import { useDisciplineMetadata } from "@/hooks/useDisciplineMetadata";
import { usePermissions } from "@/hooks/usePermissions";
import type { BrowsingDisciplineInit } from "@/lib/site/discipline-scope";
import type { StatsScope } from "@/lib/site/stats-scope";

import { useUsersIndexParams } from "./useUsersIndexParams";
import { useUsersIndexData } from "./useUsersIndexData";
import { UsersIndexHero } from "./UsersIndexHero";
import { UsersIndexFilters } from "./UsersIndexFilters";
import { UsersTableView } from "./UsersTableView";
import { UsersCatalogView } from "./UsersCatalogView";
import { UsersCompareBar, useCompareSelection } from "./UsersCompareBar";

/**
 * The player index of one game (§2.3 concrete browsing). Both views share one set of URL-backed filters; only the
 * one on screen fetches its own list, and the compare selection survives a switch between them.
 *
 * `scope` is resolved on the server (the cross-workspace mode does not exist
 * on a tenant host).
 */
const UsersClient = ({ scope, initial }: Readonly<{ scope: StatsScope; initial: BrowsingDisciplineInit }>) => {
  const browsing = useBrowsingDiscipline({ allowsAll: false, initial });
  const { resolved, disciplines } = browsing;
  const discipline = resolved?.kind === "concrete" ? resolved.code : null;
  // The game's roles name the role chips and its native ladder is the all-communities division facet.
  const metadata = useDisciplineMetadata(browsing.axis, discipline).data ?? null;
  const controls = useUsersIndexParams(scope, discipline, metadata);
  const data = useUsersIndexData(controls.params, discipline, metadata);
  const compare = useCompareSelection();
  const { view } = controls.params;
  const { canAccessAnyPermission } = usePermissions();
  const { workspaceId } = data;
  // The game has no grid on this axis: every list read is refused the same way, so the notice stands in for the view.
  const gridMissing = isDivisionGridRequired((view === "catalog" ? data.catalogQuery : data.overviewQuery).error);

  if ((resolved?.kind === "invalid" || resolved?.kind === "empty") && disciplines) {
    return <DisciplineUnavailable resolved={resolved} disciplines={disciplines} allowsAll={false} onSelect={browsing.select} />;
  }

  return (
    // Bottom padding leaves room for the fixed compare bar.
    <div className="space-y-4 pb-24">
      {disciplines && discipline ? (
        <div className="flex justify-end">
          <DisciplineSelector disciplines={disciplines} value={discipline} allowsAll={false} onSelect={browsing.select} />
        </div>
      ) : null}
      <UsersIndexHero stats={data.statsQuery.data} />
      <UsersIndexFilters
        controls={controls}
        stats={data.statsQuery.data}
        ontology={data.ontology}
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

      {gridMissing && discipline ? (
        <MissingGridNotice
          discipline={discipline}
          gameName={disciplines?.find((entry) => entry.code === discipline)?.name ?? discipline}
          // Only a workspace's own grid can be fixed from its settings; the all-workspaces axis has none to edit.
          canManage={
            typeof workspaceId === "number" &&
            canAccessAnyPermission(["division_grid.create", "division_grid.update"], workspaceId)
          }
        />
      ) : view === "catalog" ? (
        <UsersCatalogView controls={controls} data={data} compare={compare} />
      ) : (
        <UsersTableView controls={controls} data={data} compare={compare} />
      )}

      <UsersCompareBar compare={compare} />
    </div>
  );
};

export default UsersClient;
