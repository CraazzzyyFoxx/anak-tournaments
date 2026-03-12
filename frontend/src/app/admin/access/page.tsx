"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import {
  accessPermissionsPermissions,
  accessRolesPermissions,
  accessUsersPermissions,
} from "@/components/admin/admin-navigation";
import { usePermissions } from "@/hooks/usePermissions";

const accessRoutes = [
  { href: "/admin/access/users", permissions: accessUsersPermissions },
  { href: "/admin/access/roles", permissions: accessRolesPermissions },
  { href: "/admin/access/permissions", permissions: accessPermissionsPermissions },
];

export default function AccessAdminIndexPage() {
  const router = useRouter();
  const { isLoaded, isSuperuser, hasAnyPermission } = usePermissions();

  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    const firstAccessibleRoute = accessRoutes.find(
      (route) => isSuperuser || hasAnyPermission(route.permissions),
    );

    if (firstAccessibleRoute) {
      router.replace(firstAccessibleRoute.href);
    }
  }, [hasAnyPermission, isLoaded, isSuperuser, router]);

  return null;
}
