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

export const WORKSPACE_SETTINGS_SECTION_LABEL_KEYS: Record<WorkspaceSettingsSectionKey, string> = {
  general: "sections.general", branding: "sections.branding", visibility: "sections.visibility",
  domain: "sections.domain", discord: "sections.discord", divisions: "sections.divisions",
  statuses: "sections.statuses", "sub-roles": "sections.subRoles",
  "registration-forms": "sections.registrationForms", subscriptions: "sections.subscriptions", quota: "sections.quota"
};

/** One sentence under the hub heading, so a section says what it decides
 * before the reader has to infer it from the controls. */
export const WORKSPACE_SETTINGS_SECTION_DESCRIPTIONS: Record<
  WorkspaceSettingsSectionKey,
  string
> = {
  general: "sectionDescriptions.general", branding: "sectionDescriptions.branding", visibility: "sectionDescriptions.visibility",
  domain: "sectionDescriptions.domain", discord: "sectionDescriptions.discord", divisions: "sectionDescriptions.divisions",
  statuses: "sectionDescriptions.statuses", "sub-roles": "sectionDescriptions.subRoles",
  "registration-forms": "sectionDescriptions.registrationForms", subscriptions: "sectionDescriptions.subscriptions", quota: "sectionDescriptions.quota"
};

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
  "general",
  "branding",
  "visibility",
  "domain",
  "discord"
] as const satisfies readonly WorkspaceSettingsSectionKey[];

export type WorkspaceRecordSectionKey = (typeof WORKSPACE_RECORD_SECTIONS)[number];

const GROUPS: ReadonlyArray<{ label: string; sections: readonly WorkspaceSettingsSectionKey[] }> = [
  {
    label: "sections.workspace",
    sections: ["general", "branding", "visibility", "domain", "discord"]
  },
  { label: "sections.competitive", sections: ["divisions", "statuses", "sub-roles", "registration-forms"] },
  { label: "sections.entitlements", sections: ["subscriptions", "quota"] }
];

/**
 * Rail groups for `SectionNav`, with `basePath` deciding which shell they
 * point at.
 *
 * `only` narrows the rail to the sections a shell actually routes: the
 * superuser's `/admin/workspaces/[id]` shell mounts `WORKSPACE_RECORD_SECTIONS`
 * only, and a link to a Divisions page that does not exist there would be
 * a 404 dressed up as navigation.
 */
export function workspaceSettingsNavGroups(
  basePath: string,
  only?: readonly WorkspaceSettingsSectionKey[],
  translate: (key: string) => string = (key) => key
): SectionNavGroup[] {
  const allowed = only ? new Set<string>(only) : null;
  return GROUPS.map((group) => ({
    label: translate(group.label),
    items: group.sections.map((section) => ({
      key: section,
      label: translate(WORKSPACE_SETTINGS_SECTION_LABEL_KEYS[section]),
      href: `${basePath}/${section}`,
      hidden: allowed ? !allowed.has(section) : false
    }))
  }));
}
