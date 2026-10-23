"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { SettingsContinuation } from "@/components/kit/SettingsContinuation";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { BrandingSection } from "./BrandingSection";
import { DiscordSection } from "./DiscordSection";
import { DomainSection } from "./DomainSection";
import { GeneralSection } from "./GeneralSection";
import { OverviewSection } from "./OverviewSection";
import { VisibilitySection } from "./VisibilitySection";
import {
  WORKSPACE_RECORD_SECTIONS,
  sectionHref,
  workspaceSectionLabel,
  workspaceSettingsPage,
  type WorkspaceRecordSectionKey
} from "./sections";

/**
 * Each section that exists under both shells is implemented once and mounted
 * twice, so the only difference between the two is where the workspace id
 * comes from.
 */
const SECTION_COMPONENTS: Record<
  WorkspaceRecordSectionKey,
  (props: Readonly<{ workspaceId: number | null }>) => React.ReactElement
> = {
  overview: OverviewSection,
  general: GeneralSection,
  branding: BrandingSection,
  visibility: VisibilitySection,
  domain: DomainSection,
  discord: DiscordSection
};

/**
 * One section between its neighbours in rail-and-tab order (Overview →
 * General → Branding → Visibility → Domain → Discord): a ghost of the next
 * one below it, a pull past the top back to the previous one. The chain ends
 * at Discord: the competitive pages are tables and editors, and a strip of a
 * table says nothing about it.
 */
function MountedSection({
  section,
  workspaceId,
  basePath
}: Readonly<{ section: WorkspaceRecordSectionKey; workspaceId: number | null; basePath: string }>) {
  const t = useTranslations("adminWorkspace.workspaceSettings");
  const Section = SECTION_COMPONENTS[section];
  const index = WORKSPACE_RECORD_SECTIONS.indexOf(section);
  const previousKey = index > 0 ? WORKSPACE_RECORD_SECTIONS[index - 1] : undefined;
  const nextKey = WORKSPACE_RECORD_SECTIONS[index + 1];
  const Next = nextKey ? SECTION_COMPONENTS[nextKey] : null;

  // A tab of a grouped page is named with its page: "Profile · Branding".
  const pageTitle = (key: WorkspaceRecordSectionKey) => {
    const page = workspaceSettingsPage(key, basePath, t);
    const label = workspaceSectionLabel(key, t);
    return page && page.tabs.length > 1 ? `${page.title} · ${label}` : label;
  };

  return (
    <SettingsContinuation
      previous={
        previousKey ? { href: sectionHref(basePath, previousKey), title: pageTitle(previousKey) } : null
      }
      next={
        nextKey && Next && workspaceId !== null
          ? {
              href: sectionHref(basePath, nextKey),
              title: pageTitle(nextKey),
              preview: <Next workspaceId={workspaceId} />
            }
          : null
      }
    >
      <Section workspaceId={workspaceId} />
    </SettingsContinuation>
  );
}

/** `/admin/settings/*` — the workspace the admin is currently working in. */
export function CurrentWorkspaceSection({
  section
}: Readonly<{ section: WorkspaceRecordSectionKey }>) {
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  return <MountedSection section={section} workspaceId={workspaceId} basePath="/admin/settings" />;
}

/** `/admin/workspaces/[id]/*` — a superuser editing someone else's workspace. */
export function RouteWorkspaceSection({
  section
}: Readonly<{ section: WorkspaceRecordSectionKey }>) {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  return (
    <MountedSection
      section={section}
      workspaceId={Number.isFinite(id) ? id : null}
      basePath={`/admin/workspaces/${params.id}`}
    />
  );
}
