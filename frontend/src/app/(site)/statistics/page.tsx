import { Suspense } from "react";
import { getTranslations } from "next-intl/server";

import { HeroCoord, PageHero } from "@/components/site/PageHero";
import { MoreLink, SectionStack } from "@/components/site/open-layout";
import { ServerGameScopeNotice } from "@/components/workspace/ServerGameScopeNotice";
import { resolveServerPageGame } from "@/lib/site/discipline-server";

import { HeroMetaSection, HeroMetaSkeleton } from "./_components/HeroMetaSection";
import { MapsSection, MapsSkeleton } from "./_components/MapsSection";
import { OverallFigures, OverallFiguresSkeleton } from "./_components/OverallFigures";
import { PlayersSection, PlayersSkeleton } from "./_components/PlayersSection";
import { RecordsSection, RecordsSkeleton } from "./_components/RecordsSection";
import { parsePlayersParams } from "./_components/statistics.model";

export const dynamic = "force-dynamic";

type Param = string | string[] | undefined;

/**
 * The all-time almanac: who is best (the players table, the records) and what is played (characters, maps).
 *
 * A multi page (spec §5): the totals are game-neutral; the players and the results-based records are every game's
 * under "all games" and the game's own under one (§6.5); characters, maps and the log-based records are one game's by
 * nature and show only when one is chosen. An invalid or empty game reads nothing but the totals.
 */
export default async function StatisticsPage({
  searchParams
}: Readonly<{ searchParams: Promise<{ discipline?: Param; sort?: Param; q?: Param; page?: Param }> }>) {
  const [t, params] = await Promise.all([getTranslations("statistics"), searchParams]);
  const { init, resolution } = await resolveServerPageGame("multi", params.discipline);
  const page = resolution?.game ?? null;
  const boards = page?.kind === "all" || page?.kind === "game";
  const game = page?.kind === "game" ? page.code : null;
  const players = parsePlayersParams(params);
  // The main host reads across every workspace, a tenant host its own (as `skipWorkspace` does for the other reads).
  const axis = init.hostLockedWorkspaceId ?? "all";
  const urlGame = Array.isArray(params.discipline) ? params.discipline[0] : params.discipline;

  return (
    <SectionStack>
      <PageHero
        eyebrow={<HeroCoord>{t("eyebrow")}</HeroCoord>}
        title={t("title")}
        lede={t("description")}
        stamp={
          <Suspense fallback={<OverallFiguresSkeleton />}>
            <OverallFigures />
          </Suspense>
        }
      />

      <ServerGameScopeNotice initial={init} />

      {boards ? (
        <Suspense key={`players-${game}`} fallback={<PlayersSkeleton sort={players.sort} />}>
          <PlayersSection discipline={game} urlDiscipline={params.discipline} params={players} />
        </Suspense>
      ) : null}

      {boards ? (
        <Suspense key={`records-${game}`} fallback={<RecordsSkeleton discipline={game} />}>
          <RecordsSection discipline={game} />
        </Suspense>
      ) : null}

      {game ? (
        <Suspense key={`heroes-${game}`} fallback={<HeroMetaSkeleton />}>
          <HeroMetaSection discipline={game} axis={axis} />
        </Suspense>
      ) : null}

      {game ? (
        <Suspense key={`maps-${game}`} fallback={<MapsSkeleton />}>
          <MapsSection discipline={game} />
        </Suspense>
      ) : null}

      <MoreLink
        href={urlGame ? `/encounters?discipline=${encodeURIComponent(urlGame)}` : "/encounters"}
        className="self-start"
      >
        {t("encountersLink")}
      </MoreLink>
    </SectionStack>
  );
}
