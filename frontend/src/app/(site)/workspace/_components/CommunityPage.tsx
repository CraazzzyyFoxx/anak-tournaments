import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { SectionStack } from "@/components/site/open-layout";
import { BlockGameTabs } from "@/components/workspace/BlockGameTabs";
import { EntityWorkspace } from "@/components/workspace/EntityWorkspace";
import { ServerGameScopeNotice } from "@/components/workspace/ServerGameScopeNotice";
import { resolveServerPageGame } from "@/lib/site/discipline-server";
import type { Workspace } from "@/types/workspace.types";

import { AboutStaff, AboutStaffSkeleton } from "./AboutStaff";
import { CommunityStats, CommunityStatsSkeleton } from "./CommunityStats";
import { CommunityTop } from "./CommunityHero";
import { HallOfFame, HallOfFameSkeleton } from "./HallOfFame";
import { NowInCommunity, NowInCommunitySkeleton } from "./NowInCommunity";

/**
 * A community's public page. Rendered at `/workspace/<slug>` on the platform host, and at `/` on the community's own
 * host (subdomain or verified custom domain), where `ownHost` drops the "you are on the platform" context row: there
 * is no platform chrome around it to come back to.
 *
 * A multi page (spec §5) over the community's games: the leaders span every game it runs, or the one in scope
 * (§6.5). The division and character blocks are one game's by nature: they follow the page's game, and under "all
 * games" read the "single" rows for themselves, with block tabs that never touch the URL (§4.3 note, §6.4).
 */
export async function CommunityPage({
  workspace,
  ownHost,
  discipline
}: Readonly<{ workspace: Workspace; ownHost: boolean; discipline: string | string[] | undefined }>) {
  const { init, resolution } = await resolveServerPageGame("multi", discipline, workspace.id);
  const page = resolution?.game ?? null;
  const block =
    page?.kind === "all" ? (await resolveServerPageGame("single", undefined, workspace.id)).resolution : resolution;
  const blockGame = block?.game.kind === "game" ? block.game.code : null;
  const blockTabs =
    page?.kind === "all" && block?.tabs ? <BlockGameTabs initial={init} axis={workspace.id} /> : null;
  return (
    <SectionStack className="pt-5">
      <EntityWorkspace workspaceId={workspace.id} />
      <CommunityTop workspace={workspace} ownHost={ownHost} />
      <Suspense fallback={<NowInCommunitySkeleton workspace={workspace} />}>
        <NowInCommunity workspace={workspace} />
      </Suspense>
      <ServerGameScopeNotice initial={init} axis={workspace.id} />
      <Suspense fallback={<HallOfFameSkeleton />}>
        <HallOfFame workspace={workspace} game={page} />
      </Suspense>
      <Suspense fallback={<CommunityStatsSkeleton workspace={workspace} />}>
        <CommunityStats workspace={workspace} discipline={blockGame} tabs={blockTabs} />
      </Suspense>
      <Suspense fallback={<AboutStaffSkeleton workspace={workspace} />}>
        <AboutStaff workspace={workspace} />
      </Suspense>
    </SectionStack>
  );
}

/** The tab title for both hosts the page is served on. */
export async function communityMetadata({
  workspace,
  ownHost
}: Readonly<{ workspace: Workspace; ownHost: boolean }>): Promise<Metadata> {
  const t = await getTranslations("workspace");
  return {
    title: t(ownHost ? "metaTitleOwnHost" : "metaTitlePlatform", { name: workspace.name })
  };
}
