"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Lock, Wrench } from "lucide-react";

import { SearchField } from "@/components/ui/search-field";
import { cn } from "@/lib/utils";
import type { RbacRole } from "@/types/rbac.types";

/**
 * The master column of Roles (T4, F15).
 *
 * Selecting a role is navigation (`?role=`), not local state, so a role's
 * editor can be linked to — which is what the old screen's dialog could not
 * do. The narrowing box is local: it filters rows already in memory (a scope
 * holds a dozen roles, fetched whole), so there is nothing to put in the URL.
 */
export function RoleList({
  roles,
  selectedRoleId,
  onSelect
}: Readonly<{
  roles: RbacRole[];
  selectedRoleId: number | null;
  onSelect: (roleId: number) => void;
}>) {
  const t = useTranslations("adminAccess.common");
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? roles.filter((role) => role.name.toLowerCase().includes(needle))
    : roles;

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="space-y-2 border-b border-border px-3 py-3">
        <p className="text-xs tabular-nums text-muted-foreground">
          {t("roleCountInScope", { count: roles.length })}
        </p>
        <SearchField
          label={t("filterRoles")}
          placeholder={t("searchRoles")}
          value={query}
          onValueChange={setQuery}
        />
      </div>

      {visible.length === 0 ? (
        <p className="p-3 text-sm text-muted-foreground">
          {roles.length === 0
            ? t("noRoles")
            : t("nothingHere")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1 p-2">
          {visible.map((role) => {
            const selected = role.id === selectedRoleId;
            return (
              <li key={role.id}>
                <button
                  type="button"
                  aria-current={selected ? "true" : undefined}
                  onClick={() => onSelect(role.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected
                      ? "border-primary bg-primary/10"
                      : "border-transparent hover:bg-accent/40"
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {role.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {role.description || t("noDescription")}
                    </span>
                  </span>
                  {role.is_system ? (
                    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      <Lock aria-hidden className="size-3.5" />
                      {t("system")}
                    </span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      <Wrench aria-hidden className="size-3.5" />
                      {t("custom")}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
