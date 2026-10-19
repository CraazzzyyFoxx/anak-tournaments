import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import { LeadersContent, LeadersSkeleton, type KpiKey } from "@/components/site/leaders";
import { Section, SectionHead } from "@/components/site/open-layout";
import statisticsService from "@/services/statistics.service";
import type { Workspace } from "@/types/workspace.types";

const TITLE_ID = "hof-title";
const TOP = 5;
const PRIMARY_KEYS = [
  "tournaments",
  "players",
  "teams",
  "champions"
] as const satisfies readonly KpiKey[];
const SECONDARY_KEYS = ["encounters", "maps", "days", "hours"] as const satisfies readonly KpiKey[];

function Shell({ children }: Readonly<{ children: React.ReactNode }>) {
  const t = useTranslations("workspace");
  return (
    <Section labelledBy={TITLE_ID}>
      <SectionHead title={t("hof.totals")} titleId={TITLE_ID} sub={t("hof.sub")} />
      {children}
    </Section>
  );
}

export function HallOfFameSkeleton() {
  return (
    <Shell>
      <LeadersSkeleton primaryKeys={PRIMARY_KEYS} secondaryKeys={SECONDARY_KEYS} />
    </Shell>
  );
}

/** Community-scoped totals and leaders (of the browsed game; none without one), using the landing page's presentation. */
export async function HallOfFame({
  workspace,
  discipline
}: Readonly<{ workspace: Workspace; discipline: string | null }>) {
  const t = await getTranslations("workspace");
  const workspaceId = workspace.id;

  const [totals, champions, winrate] = await Promise.all([
    statisticsService.getOverallStatistics({ workspaceId }).catch(() => null),
    discipline ? statisticsService.getChampions(discipline, { workspaceId }).catch(() => null) : null,
    discipline ? statisticsService.getTopWinratePlayers(discipline, { workspaceId }).catch(() => null) : null
  ]);

  return (
    <Shell>
      {await LeadersContent({
        totals,
        primaryKeys: PRIMARY_KEYS,
        secondaryKeys: SECONDARY_KEYS,
        boards: discipline
          ? [
              {
                title: t("hof.mostWins"),
                sub: t("hof.mostWinsSub"),
                rows: champions === null ? null : champions.results.slice(0, TOP),
                value: "wins"
              },
              {
                title: t("hof.bestWinrate"),
                sub: t("hof.winrateSub"),
                hint: t("hof.winrateHint"),
                rows: winrate === null ? null : winrate.results.slice(0, TOP),
                value: "winrate",
                empty: t("hof.winrateEmpty")
              }
            ]
          : []
      })}
    </Shell>
  );
}
