import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { SectionStack } from "@/components/site/open-layout";
import { EntityWorkspace } from "@/components/workspace/EntityWorkspace";
import { ServerBrowsingDiscipline } from "@/components/workspace/ServerBrowsingDiscipline";
import { resolveServerBrowsingDiscipline } from "@/lib/site/discipline-server";
import type { Workspace } from "@/types/workspace.types";

import { AboutStaff, AboutStaffSkeleton } from "./AboutStaff";
import { CommunityStats, CommunityStatsSkeleton } from "./CommunityStats";
import { CommunityTop } from "./CommunityHero";
import { HallOfFame, HallOfFameSkeleton } from "./HallOfFame";
import { NowInCommunity, NowInCommunitySkeleton } from "./NowInCommunity";

/**
 * A community's public page. Rendered at `/workspace/<slug>` on the platform
 * host, and at `/` on the community's own host (subdomain or verified custom
 * domain), where `ownHost` drops the "you are on the platform" context row:
 * there is no platform chrome around it to come back to. Its statistics are one
 * of the community's games (§2.3 concrete browsing, `?discipline=`).
 */
export async function CommunityPage({
  workspace,
  ownHost,
  discipline
}: Readonly<{ workspace: Workspace; ownHost: boolean; discipline: string | string[] | undefined }>) {
  const browsing = await resolveServerBrowsingDiscipline(discipline, workspace.id);
  // No game (invalid/empty/unreadable): the game-neutral sections stay, the per-game ones read nothing.
  const game = browsing.resolved?.kind === "concrete" ? browsing.resolved.code : null;
  return (
    <SectionStack className="pt-5">
      <EntityWorkspace workspaceId={workspace.id} />
      <CommunityTop workspace={workspace} ownHost={ownHost} />
      <Suspense fallback={<NowInCommunitySkeleton workspace={workspace} />}>
        <NowInCommunity workspace={workspace} />
      </Suspense>
      <div className="flex justify-end">
        <ServerBrowsingDiscipline initial={browsing.init} axis={workspace.id} />
      </div>
      <Suspense fallback={<HallOfFameSkeleton />}>
        <HallOfFame workspace={workspace} discipline={game} />
      </Suspense>
      <Suspense fallback={<CommunityStatsSkeleton workspace={workspace} />}>
        <CommunityStats workspace={workspace} discipline={game} />
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
