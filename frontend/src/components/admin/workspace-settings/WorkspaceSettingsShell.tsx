"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { LinkTabs } from "@/components/kit/LinkTabs";
import { SectionNav, useSectionNavEntrance } from "@/components/kit/SectionNav";
import { SettingsOutlineProvider } from "@/components/kit/SettingsOutline";
import { useInSettingsPreview } from "@/components/kit/SettingsContinuation";
import { cn } from "@/lib/utils";
import {
  WORKSPACE_SETTINGS_SECTIONS,
  workspaceSettingsNavGroups,
  workspaceSettingsPage,
  type WorkspaceSettingsSectionKey
} from "./sections";

export interface WorkspaceSettingsShellProps {
  /** Route prefix the rail links against: `/admin/settings` or `/admin/workspaces/8`. */
  basePath: string;
  /** Sections this shell routes; the rest are hidden from the rail. */
  sections?: readonly WorkspaceSettingsSectionKey[];
  children: ReactNode;
}

/**
 * Screens under the hub that render without the hub's chrome.
 *
 * A child `layout.tsx` cannot remove a parent one — Next.js nests them — so
 * the division-grid editor's own full-screen layout would still sit inside
 * this header and rail, making its three columns a fourth column short of the
 * viewport (the layout IA §9 rejects). The opt-out therefore has to live where
 * the chrome is rendered, not where it is unwanted.
 */
const FULL_SCREEN_PREFIXES = ["/admin/settings/divisions/v/"] as const;

const HeaderActionsContext = createContext<HTMLElement | null>(null);

/**
 * Puts a section's page-level controls (the audit trail, a discipline picker)
 * into the shell's header, beside the title they act on, instead of a row of
 * their own above the form. Renders nothing outside a settings shell, or for
 * the next page's ghost, whose header is not this one.
 */
export function SettingsHeaderActions({ children }: Readonly<{ children: ReactNode }>) {
  const node = useContext(HeaderActionsContext);
  const inPreview = useInSettingsPreview();
  return node && !inPreview ? createPortal(children, node) : null;
}

/**
 * Chrome of the workspace settings hub (T5): the section rail, the page
 * heading, the page's tabs and nothing else.
 *
 * Both shells mount this one — `/admin/settings` for the workspace an admin is
 * in, `/admin/workspaces/[id]` for a superuser looking at another — so a
 * section page is only its own form, and neither shell can drift into a second
 * heading or a second rail.
 *
 * The active section is resolved from the first path segment after `basePath`,
 * not the last segment of the URL: `/admin/settings/divisions/import` is a
 * child screen of Divisions and has to leave that rail item current. The bare
 * `basePath` is the overview. The rail marks the page that owns the section;
 * the tabs mark the section itself.
 *
 * The heading sits in the content column, as on the tournament settings hub,
 * so the title, the tabs and the form share one leading edge. Form pages are
 * capped at a readable width; table and list/detail pages take the column.
 */
export function WorkspaceSettingsShell({
  basePath,
  sections,
  children
}: Readonly<WorkspaceSettingsShellProps>) {
  const t = useTranslations("adminWorkspace.workspaceSettings");
  const pathname = usePathname();
  const [actionsNode, setActionsNode] = useState<HTMLDivElement | null>(null);
  const columnRef = useSectionNavEntrance<HTMLDivElement>();
  if (FULL_SCREEN_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return <>{children}</>;

  const trailing = pathname.startsWith(basePath) ? pathname.slice(basePath.length) : "";
  const segment = trailing.split("/").filter(Boolean)[0] ?? "overview";
  const activeKey = (WORKSPACE_SETTINGS_SECTIONS as readonly string[]).includes(segment)
    ? (segment as WorkspaceSettingsSectionKey)
    : null;
  const page = activeKey ? workspaceSettingsPage(activeKey, basePath, t, sections) : null;

  return (
    <SettingsOutlineProvider>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
        <SectionNav
          groups={workspaceSettingsNavGroups(basePath, t, sections)}
          activeKey={page?.key ?? ""}
        />
        {/* Not `<main>`: the admin shell already exposes the page-level main
            landmark (`AdminLayoutClient`'s `#admin-content`). */}
        <div ref={columnRef} className={cn("flex min-w-0 flex-1 flex-col gap-4", !page?.wide && "max-w-3xl")}>
          <AdminPageHeader
            title={page?.title ?? t("sections.settingsTitle")}
            description={page?.description}
            actions={<div ref={setActionsNode} className="flex flex-wrap items-center gap-2" />}
          />
          {page && activeKey ? (
            <LinkTabs items={page.tabs} activeKey={activeKey} ariaLabel={page.title} />
          ) : null}
          <HeaderActionsContext.Provider value={actionsNode}>
            {children}
          </HeaderActionsContext.Provider>
        </div>
      </div>
    </SettingsOutlineProvider>
  );
}
