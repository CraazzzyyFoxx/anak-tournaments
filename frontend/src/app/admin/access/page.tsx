"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { accessSectionViews, adminRouteAccessOptions } from "@/components/admin/admin-navigation";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspaceStore } from "@/stores/workspace.store";

/**
 * The Access hub root is not a screen: it forwards to the first section the
 * caller may actually open.
 *
 * A static redirect (what `/admin/settings` does) cannot work here, because
 * Access mixes gate classes: Accounts, Permissions and OAuth are global-RBAC
 * reads, Sessions is superuser-only, and Roles and API keys belong to a
 * workspace admin. The sidebar entry used to point straight at Accounts, so
 * every workspace admin who clicked the one Access entry they were shown got
 * the Unauthorized wall instead of the two sections they own.
 *
 * The target is resolved through `adminRouteAccessOptions`, the same route
 * table the layout guard checks, so this can never forward somewhere the guard
 * then rejects.
 */
export default function AccessAdminIndex() {
  const router = useRouter();
  const { isLoaded, canAccessAdminRoute } = usePermissions();
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);

  const target = isLoaded
    ? accessSectionViews.find((view) =>
        canAccessAdminRoute(adminRouteAccessOptions(view.href, currentWorkspaceId))
      )?.href
    : undefined;

  useEffect(() => {
    if (target) router.replace(target);
  }, [router, target]);

  // No section is open to this caller: the hub layout already renders that
  // state under the (empty) tab bar.
  return null;
}
