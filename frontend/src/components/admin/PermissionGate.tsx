"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

import { PageStateCard } from "@/components/ui/page-state-card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The permission gate of an admin page: a placeholder while the grants load,
 * one "No access" card saying why when the page's grant is missing, the page
 * otherwise. `description` names the grant in words — the reason is the only
 * part that differs between pages.
 */
export function PermissionGate({
  loaded,
  allowed,
  description,
  children
}: Readonly<{
  loaded: boolean;
  allowed: boolean;
  description: string;
  children: ReactNode;
}>) {
  const t = useTranslations("common");
  if (!loaded) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (!allowed)
    return <PageStateCard state="not-found" title={t("noAccess")} description={description} />;
  return children;
}
