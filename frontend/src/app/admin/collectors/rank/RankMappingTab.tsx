"use client";

import { useTranslations } from "next-intl";

import { DisciplineSelector, DisciplineUnavailable } from "@/components/workspace/DisciplineSelector";
import { PageStateCard } from "@/components/ui/page-state-card";
import { Skeleton } from "@/components/ui/skeleton";
import { DisciplineWidget } from "@/disciplines/DisciplineWidget";
import { loadAdminUI } from "@/disciplines/registry/admin";
import { useBrowsingDiscipline } from "@/hooks/useBrowsingDiscipline";

/**
 * The collector's rank-mapping tab: a concrete-browsing surface (§2.3). The game is resolved first
 * (`?discipline=`, saved choice, first installed game) and shown in the selector; only then is its
 * `native_rank_collection` capability checked by the slot host. A game that does not collect ranks gets the
 * unsupported message — never another game's mapping panel.
 */
export function RankMappingTab() {
  const t = useTranslations("collectors");
  // The collector settings are platform-wide, so the installed games are listed globally.
  const browsing = useBrowsingDiscipline({ allowsAll: false, axis: "all" });
  const { resolved, disciplines } = browsing;

  if (resolved === null) {
    return browsing.isError ? (
      <PageStateCard
        state="error"
        title={t("mapping.noCollectorTitle")}
        description={t("mapping.noCollector")}
        onAction={browsing.refetch}
      />
    ) : (
      <Skeleton className="h-40 w-full rounded-xl" />
    );
  }
  if (resolved.kind === "invalid" || resolved.kind === "empty") {
    return (
      <DisciplineUnavailable
        resolved={resolved}
        disciplines={disciplines ?? []}
        allowsAll={false}
        onSelect={browsing.select}
      />
    );
  }
  if (resolved.kind === "all") return null;
  const descriptor = disciplines?.find((entry) => entry.code === resolved.code);
  if (!descriptor) return null;

  return (
    <div className="space-y-4">
      <DisciplineSelector
        disciplines={disciplines ?? []}
        value={resolved.code}
        allowsAll={false}
        onSelect={browsing.select}
      />
      <DisciplineWidget
        discipline={descriptor.code}
        load={loadAdminUI}
        slot="rankMapping"
        capabilities={descriptor.capabilities}
        requires="native_rank_collection"
        props={{}}
        fallback={null}
      />
    </div>
  );
}
