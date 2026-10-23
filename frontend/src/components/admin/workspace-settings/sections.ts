import type { useTranslations } from "next-intl";

import type { LinkTabItem } from "@/components/kit/LinkTabs";
import type { SectionNavGroup } from "@/components/kit/SectionNav";

/**
 * Every routed section of the workspace settings hub (T5): one URL segment
 * each, so a link to `/admin/settings/branding` keeps meaning "brand the
 * workspace I am in" whatever the rail looks like.
 *
 * Before the redesign most of these concerns lived in five unrelated routes
 * (`/admin/workspaces/[id]`, `/admin/divisions`, `/admin/balancer`,
 * `/admin/sub-roles`, `/admin/subscriptions`) and nothing told the reader they
 * were the same settings surface.
 */
export const WORKSPACE_SETTINGS_SECTIONS = [
  "overview",
  "general",
  "branding",
  "visibility",
  "domain",
  "discord",
  "divisions",
  "sub-roles",
  "statuses",
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

/**
 * A rail item: one or more sections behind one heading, the sections shown as
 * routed tabs. Twelve sections were twelve rail items, several of them a
 * single switch; grouping the small, related ones keeps the rail short without
 * moving a single URL.
 *
 * `wide` pages hold tables and list/detail editors and take the full column;
 * every other page is a form, capped at a readable width.
 */
interface WorkspaceSettingsPage {
  key: string;
  /** Message key of a multi-section page's own title; a single section uses its label. */
  titleKey?: "profile" | "roles" | "access";
  descriptionKey:
    | "overview"
    | "profile"
    | "domain"
    | "discord"
    | "divisions"
    | "roles"
    | "registrationForms"
    | "access";
  sections: readonly WorkspaceSettingsSectionKey[];
  wide?: boolean;
}

const RAIL: ReadonlyArray<{
  label: "workspace" | "competitive";
  pages: readonly WorkspaceSettingsPage[];
}> = [
  {
    label: "workspace",
    pages: [
      { key: "overview", descriptionKey: "overview", sections: ["overview"] },
      {
        key: "profile",
        titleKey: "profile",
        descriptionKey: "profile",
        sections: ["general", "branding", "visibility"]
      },
      { key: "domain", descriptionKey: "domain", sections: ["domain"] },
      { key: "discord", descriptionKey: "discord", sections: ["discord"] }
    ]
  },
  {
    label: "competitive",
    pages: [
      { key: "divisions", descriptionKey: "divisions", sections: ["divisions"], wide: true },
      {
        key: "roles",
        titleKey: "roles",
        descriptionKey: "roles",
        sections: ["sub-roles", "statuses"],
        wide: true
      },
      {
        key: "registration-forms",
        descriptionKey: "registrationForms",
        sections: ["registration-forms"],
        wide: true
      },
      {
        key: "access",
        titleKey: "access",
        descriptionKey: "access",
        sections: ["subscriptions", "quota"]
      }
    ]
  }
];

export function sectionHref(basePath: string, section: WorkspaceSettingsSectionKey): string {
  // There is no `/overview` route: the bare `basePath` is the overview.
  return section === "overview" ? basePath : `${basePath}/${section}`;
}

/** The sections of a page a shell actually routes, in tab order. */
function routedSections(
  page: WorkspaceSettingsPage,
  only: readonly WorkspaceSettingsSectionKey[] | undefined
): WorkspaceSettingsSectionKey[] {
  return only ? page.sections.filter((section) => only.includes(section)) : [...page.sections];
}

export interface ResolvedWorkspaceSettingsPage {
  key: string;
  title: string;
  description: string;
  wide: boolean;
  /** Routed tabs; `LinkTabs` renders nothing for fewer than two. */
  tabs: LinkTabItem[];
}

/** The page that owns `section`, as the shell renders it. */
export function workspaceSettingsPage(
  section: WorkspaceSettingsSectionKey,
  basePath: string,
  t: WorkspaceSettingsTranslator,
  only?: readonly WorkspaceSettingsSectionKey[]
): ResolvedWorkspaceSettingsPage | null {
  const page = RAIL.flatMap((group) => group.pages).find((candidate) =>
    candidate.sections.includes(section)
  );
  if (!page) return null;
  const sections = routedSections(page, only);
  return {
    key: page.key,
    title: page.titleKey
      ? t(`pages.${page.titleKey}`)
      : workspaceSectionLabel(sections[0] ?? section, t),
    description: t(`descriptions.${page.descriptionKey}`),
    wide: page.wide ?? false,
    tabs: sections.map((tab) => ({
      key: tab,
      label: workspaceSectionLabel(tab, t),
      href: sectionHref(basePath, tab)
    }))
  };
}

/**
 * Rail groups for `SectionNav`, with `basePath` deciding which shell they
 * point at. A page links to its first routed section.
 *
 * `only` narrows the rail to the sections a shell actually routes: the
 * superuser's `/admin/workspaces/[id]` shell mounts `WORKSPACE_RECORD_SECTIONS`
 * only, and a link to a Divisions page that does not exist there would be
 * a 404 dressed up as navigation. A page with no routed section is hidden.
 */
export function workspaceSettingsNavGroups(
  basePath: string,
  t: WorkspaceSettingsTranslator,
  only?: readonly WorkspaceSettingsSectionKey[]
): SectionNavGroup[] {
  return RAIL.map((group) => ({
    label: t(`sections.${group.label}`),
    items: group.pages.map((page) => {
      const sections = routedSections(page, only);
      const first = sections[0] ?? page.sections[0];
      return {
        key: page.key,
        label: page.titleKey ? t(`pages.${page.titleKey}`) : workspaceSectionLabel(first, t),
        href: sectionHref(basePath, first),
        hidden: sections.length === 0
      };
    })
  }));
}
