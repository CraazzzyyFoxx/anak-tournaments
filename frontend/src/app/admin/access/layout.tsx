"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";

import { AdminTabbedPage } from "@/components/admin/AdminTabbedPage";
import type { LinkTabItem } from "@/components/kit/LinkTabs";
import { PageStateCard } from "@/components/ui/page-state-card";
import {
  accessApiKeysPermissions,
  accessPermissionsPermissions,
  accessRolesPermissions,
  accessUsersPermissions
} from "@/lib/auth/admin-permissions";
import { type AppPermission, usePermissions } from "@/hooks/usePermissions";

/**
 * The six Access sections and the gate each one keeps.
 *
 * These MUST agree with `adminRoutePermissions` in `admin-navigation.ts` —
 * that table guards the route, this one hides the tab, and a tab visible to
 * someone the route rejects is a dead end. Accounts, OAuth and Permissions are
 * global-only reads; Roles and API keys are also visible to a workspace admin;
 * Sessions is superuser-only.
 */
const ACCESS_TABS: {
  key: string;
  labelKey: "accounts" | "roles" | "permissions" | "apiKeys" | "oauth" | "sessions";
  permissions: AppPermission[];
  workspaceAdminVisible?: boolean;
  superuserOnly?: boolean;
}[] = [
  { key: "accounts", labelKey: "accounts", permissions: accessUsersPermissions },
  {
    key: "roles",
    labelKey: "roles",
    permissions: accessRolesPermissions,
    workspaceAdminVisible: true
  },
  { key: "permissions", labelKey: "permissions", permissions: accessPermissionsPermissions },
  {
    key: "api-keys",
    labelKey: "apiKeys",
    permissions: accessApiKeysPermissions,
    workspaceAdminVisible: true
  },
  { key: "oauth", labelKey: "oauth", permissions: accessUsersPermissions },
  { key: "sessions", labelKey: "sessions", permissions: [], superuserOnly: true }
];

/**
 * Access (F15): navigation and chrome only.
 *
 * The hand-rolled pill `<nav>` this replaces was the last bespoke tab bar in
 * the admin panel; it is now the same `LinkTabs` every other hub uses, so a
 * section reads as a tab whether you arrive from the sidebar, the command
 * palette or a link.
 */
export default function AccessAdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  const t = useTranslations("adminAccess.access");
  const tc = useTranslations("adminAccess.common");
  const pathname = usePathname();
  const { isSuperuser, hasAnyPermission, hasAnyWorkspacePermission, canManageAnyWorkspace } =
    usePermissions();

  const items: LinkTabItem[] = ACCESS_TABS.map((tab) => {
    const visible = tab.superuserOnly
      ? isSuperuser
      : isSuperuser ||
        hasAnyPermission(tab.permissions) ||
        (tab.workspaceAdminVisible === true &&
          (hasAnyWorkspacePermission(tab.permissions) || canManageAnyWorkspace()));

    return {
      key: tab.key,
      label: tc(tab.labelKey),
      href: `/admin/access/${tab.key}`,
      hidden: !visible
    };
  });

  const activeKey =
    ACCESS_TABS.find((tab) => pathname.startsWith(`/admin/access/${tab.key}`))?.key ?? "";

  return (
    <AdminTabbedPage title={t("title")} tabs={items} activeKey={activeKey} ariaLabel={t("sections")}>
      {items.every((item) => item.hidden) ? (
        <PageStateCard
          state="empty"
          title={t("noSection")}
          description={t("noSectionDescription")}
        />
      ) : (
        children
      )}
    </AdminTabbedPage>
  );
}
