import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import { LeadersContent, LeadersSkeleton, type KpiKey } from "@/components/site/leaders";
import { MoreLink, Section, SectionHead } from "@/components/site/open-layout";
import { ServerGameTabs } from "@/components/workspace/ServerGameTabs";
import statisticsService from "@/services/statistics.service";
import { resolveServerPageGame } from "@/lib/site/discipline-server";

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
 * Platform scale first, followed by the two all-time player leaderboards of one game (a single block until the
 * cross-game leaderboards land): the raw `?discipline=` decides it like any single page, with local game tabs under
 * "all games", and an invalid one is named, never replaced by a fallback.
 */
export async function PlatformLeaders({ discipline }: Readonly<{ discipline: string | string[] | undefined }>) {
  const browsing = await resolveServerPageGame("single", discipline);
  // The leaderboards are one game's; with no game to read there are none (the totals are game-neutral).
  const game = browsing.resolution?.game.kind === "game" ? browsing.resolution.game.code : null;
  const [t, overall, champions, winrate, workspaces] = await Promise.all([
    getTranslations("home.leaders"),
    statisticsService.getOverallStatistics({ skipWorkspace: true }).catch(() => null),
    game ? statisticsService.getChampions(game, { skipWorkspace: true }).catch(() => null) : null,
    game ? statisticsService.getTopWinratePlayers(game, { skipWorkspace: true }).catch(() => null) : null,
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
      <div className="flex justify-end">
        <ServerGameTabs initial={browsing.init} />
      </div>
      {await LeadersContent({
        totals,
        primaryKeys: PRIMARY_KEYS,
        secondaryKeys: SECONDARY_KEYS,
        boards: game
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
