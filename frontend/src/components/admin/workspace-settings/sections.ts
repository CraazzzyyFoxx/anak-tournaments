import type { useTranslations } from "next-intl";

import type { SectionNavGroup } from "@/components/kit/SectionNav";

/**
 * Every section of the workspace settings hub (T5), in rail order.
 *
 * One list, so the rail, the mobile `Select` and each section's own heading
 * cannot drift apart: before the redesign most of these concerns lived in five
 * unrelated routes (`/admin/workspaces/[id]`, `/admin/divisions`,
 * `/admin/balancer`, `/admin/sub-roles`, `/admin/subscriptions`) and nothing
 * told the reader they were the same settings surface.
 */
export const WORKSPACE_SETTINGS_SECTIONS = [
  "overview",
  "general",
  "branding",
  "visibility",
  "domain",
  "discord",
  "divisions",
  "statuses",
  "sub-roles",
  "registration-forms",
  "subscriptions",
  "quota"
] as const;

export type WorkspaceSettingsSectionKey = (typeof WORKSPACE_SETTINGS_SECTIONS)[number];

/**
 * Each section's key under `sections.*` in `adminWorkspace.workspaceSettings`:
 * the slugs are kebab-case, message keys are camelCase.
 */
const SECTION_MESSAGE_KEYS = {
  overview: "overview",
  general: "general",
  branding: "branding",
  visibility: "visibility",
  domain: "domain",
  discord: "discord",
  divisions: "divisions",
  statuses: "statuses",
  "sub-roles": "subRoles",
  "registration-forms": "registrationForms",
  subscriptions: "subscriptions",
  quota: "quota"
} as const satisfies Record<WorkspaceSettingsSectionKey, string>;

export type WorkspaceSettingsTranslator = ReturnType<
  typeof useTranslations<"adminWorkspace.workspaceSettings">
>;

export function workspaceSectionLabel(
  section: WorkspaceSettingsSectionKey,
  t: WorkspaceSettingsTranslator
): string {
  return t(`sections.${SECTION_MESSAGE_KEYS[section]}`);
}

/**
 * The sections that exist under both shells: `/admin/settings/*` for the
 * workspace an admin is currently in, and `/admin/workspaces/[id]/*` for a
 * superuser looking at someone else's. Most are a form over the workspace
 * record itself; Discord also carries the announcement and mix settings, which
 * are scoped by the same id and a superuser has the same reason to reach. The
 * rest are workspace-scoped screens of their own and only ever mount under
 * `/admin/settings`.
 */
export const WORKSPACE_RECORD_SECTIONS = [
  "overview",
  "general",
  "branding",
  "visibility",
  "domain",
  "discord"
] as const satisfies readonly WorkspaceSettingsSectionKey[];

export type WorkspaceRecordSectionKey = (typeof WORKSPACE_RECORD_SECTIONS)[number];

const GROUPS: ReadonlyArray<{
  label: "workspace" | "competitive" | "entitlements";
  sections: readonly WorkspaceSettingsSectionKey[];
}> = [
  {
    label: "workspace",
    sections: ["overview", "general", "branding", "visibility", "domain", "discord"]
  },
  { label: "competitive", sections: ["divisions", "statuses", "sub-roles", "registration-forms"] },
  { label: "entitlements", sections: ["subscriptions", "quota"] }
];

/**
 * Rail groups for `SectionNav`, with `basePath` deciding which shell they
 * point at. Overview is the shell's root itself: there is no `/overview`
 * route, the bare `basePath` is the overview.
 *
 * `only` narrows the rail to the sections a shell actually routes: the
 * superuser's `/admin/workspaces/[id]` shell mounts `WORKSPACE_RECORD_SECTIONS`
 * only, and a link to a Divisions page that does not exist there would be
 * a 404 dressed up as navigation.
 */
export function workspaceSettingsNavGroups(
  basePath: string,
  t: WorkspaceSettingsTranslator,
  only?: readonly WorkspaceSettingsSectionKey[]
): SectionNavGroup[] {
  const allowed = only ? new Set<string>(only) : null;
  return GROUPS.map((group) => ({
    label: t(`sections.${group.label}`),
    items: group.sections.map((section) => ({
      key: section,
      label: workspaceSectionLabel(section, t),
      href: section === "overview" ? basePath : `${basePath}/${section}`,
      hidden: allowed ? !allowed.has(section) : false
    }))
  }));
}
