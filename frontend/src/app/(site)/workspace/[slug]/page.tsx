import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CommunityPage, communityMetadata } from "../_components/CommunityPage";
import workspaceService from "@/services/workspace.service";
import type { Workspace } from "@/types/workspace.types";

/**
 * By slug under the switcher's visibility: a community's own page stays
 * reachable for its members while it is still `unverified` or hidden, and is a
 * 404 for everyone else. Cached so the metadata and the page itself resolve the
 * slug with one read.
 */
const resolveWorkspace = cache(async (slug: string): Promise<Workspace> => {
  try {
    return await workspaceService.getBySlug(slug);
  } catch {
    notFound();
  }
});

export async function generateMetadata({
  params
}: Readonly<{ params: Promise<{ slug: string }> }>): Promise<Metadata> {
  const { slug } = await params;
  return communityMetadata({ workspace: await resolveWorkspace(slug), ownHost: false });
}

export default async function WorkspacePage({
  params,
  searchParams
}: Readonly<{
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ discipline?: string | string[] }>;
}>) {
  const [{ slug }, { discipline }] = await Promise.all([params, searchParams]);
  return <CommunityPage workspace={await resolveWorkspace(slug)} ownHost={false} discipline={discipline} />;
}
