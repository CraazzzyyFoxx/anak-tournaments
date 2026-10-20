import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import { LeadersContent, LeadersSkeleton, type KpiKey } from "@/components/site/leaders";
import { MoreLink, Section, SectionHead } from "@/components/site/open-layout";
import { ServerGameScopeNotice } from "@/components/workspace/ServerGameScopeNotice";
import { resolveServerPageGame } from "@/lib/site/discipline-server";
import statisticsService from "@/services/statistics.service";

import { getPublicWorkspaces } from "./home-data";

const TITLE_ID = "home-leaders-title";
const PRIMARY_KEYS = [
  "tournaments",
  "players",
  "teams",
  "communities"
] as const satisfies readonly KpiKey[];
const SECONDARY_KEYS = [
  "encounters",
  "maps",
  "days",
  "hours",
  "champions"
] as const satisfies readonly KpiKey[];

/**
 * Platform scale first, then the two all-time player leaderboards (spec §6.5): one cross-game top under "all games",
 * the game's own under one. An invalid or empty game reads no board and shows its notice, never another game's.
 */
export async function PlatformLeaders({ discipline }: Readonly<{ discipline: string | string[] | undefined }>) {
  const { init, resolution } = await resolveServerPageGame("multi", discipline);
  const page = resolution?.game ?? null;
  const boards = page?.kind === "all" || page?.kind === "game";
  const game = page?.kind === "game" ? page.code : null;
  const [t, overall, champions, winrate, workspaces] = await Promise.all([
    getTranslations("home.leaders"),
    statisticsService.getOverallStatistics({ skipWorkspace: true }).catch(() => null),
    boards ? statisticsService.getChampions(game, { skipWorkspace: true }).catch(() => null) : null,
    boards ? statisticsService.getTopWinratePlayers(game, { skipWorkspace: true }).catch(() => null) : null,
    getPublicWorkspaces().catch(() => null)
  ]);

  // Communities come from the public catalogue, not the tournament totals.
  const totals = overall ? { ...overall, communities: workspaces?.length } : null;

  return (
    <Section labelledBy={TITLE_ID}>
      <SectionHead
        title={t("totals")}
        titleId={TITLE_ID}
        sub={t("sub")}
        aside={
          <MoreLink href="/statistics" className="min-h-11 whitespace-nowrap">
            {t("more")}
          </MoreLink>
        }
      />
      <ServerGameScopeNotice initial={init} />
      {await LeadersContent({
        totals,
        primaryKeys: PRIMARY_KEYS,
        secondaryKeys: SECONDARY_KEYS,
        boards: boards
          ? [
              {
                title: t("mostWins"),
                sub: t("winsSub"),
                rows: champions ? champions.results.slice(0, 5) : null,
                value: "wins"
              },
              {
                title: t("bestWinrate"),
                sub: t("winrateSub"),
                hint: t("winrateTitle"),
                rows: winrate ? winrate.results.slice(0, 5) : null,
                value: "winrate"
              }
            ]
          : []
      })}
    </Section>
  );
}

export function PlatformLeadersSkeleton() {
  const t = useTranslations("home.leaders");

  return (
    <Section labelledBy={TITLE_ID}>
      <SectionHead
        title={t("totals")}
        titleId={TITLE_ID}
        sub={t("sub")}
        aside={
          <MoreLink href="/statistics" className="min-h-11 whitespace-nowrap">
            {t("more")}
          </MoreLink>
        }
      />
      <LeadersSkeleton primaryKeys={PRIMARY_KEYS} secondaryKeys={SECONDARY_KEYS} />
    </Section>
  );
}
