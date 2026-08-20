"use client";

import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ROLES, ROLE_LABELS } from "@/lib/roles";

export interface CatalogEntry {
  id: number;
  slug: string;
  label: string;
}

/**
 * Per-tournament sub-role *offering*. Toggling a chip selects whether that
 * sub-role is offered on this tournament's registration form (a role with no
 * explicit selection offers all of its catalog options).
 *
 * The catalog itself is workspace-global and is managed on `/admin/sub-roles`:
 * creating or removing an entry from here used to rewrite the options of every
 * other tournament in the workspace, plus the player, roster and balancer
 * pickers that read the same table.
 */
export function SubrolesTab({
  catalog,
  selection,
  onToggleOffered,
  isLoading = false
}: Readonly<{
  /** Workspace catalog grouped by registration role code, with row ids. */
  catalog: Record<string, CatalogEntry[]>;
  /** Current per-role offered selection (slug list), or undefined = offer all. */
  selection: Record<string, string[] | undefined>;
  onToggleOffered: (role: string, slug: string, nextSlugs: string[]) => void;
  isLoading?: boolean;
}>) {
  const t = useTranslations("registrationFormAdmin.subroles");

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle asChild><h2>{t("title")}</h2></CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </div>
        <Button variant="outline" size="sm" asChild className="shrink-0">
          <Link href="/admin/sub-roles">
            {t("editCatalog")}
            <ArrowRight className="ml-2 size-3.5" aria-hidden />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {ROLES.map((role) => {
          const options = catalog[role.code] ?? [];
          const roleSelection = selection[role.code];
          const allSlugs = options.map((option) => option.slug);

          return (
            <div key={role.code} className="space-y-2 rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {ROLE_LABELS[role.code] ?? role.display}
                </span>
                {options.length > 0 && roleSelection !== undefined && (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {t("offeredCount", {
                      count: roleSelection.filter((slug) => allSlugs.includes(slug)).length,
                      total: options.length,
                    })}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {options.map((option) => {
                  const offered = roleSelection === undefined || roleSelection.includes(option.slug);
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        const effective = roleSelection ?? allSlugs;
                        const next = offered
                          ? effective.filter((slug) => slug !== option.slug)
                          : [...effective, option.slug];
                        onToggleOffered(role.code, option.slug, next);
                      }}
                      aria-pressed={offered}
                      title={offered ? t("chipOffered") : t("chipHidden")}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                        offered
                          ? "border-primary/30 bg-primary/10 text-primary"
                          : "border-border/60 text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {offered && <Check className="size-3" aria-hidden />}
                      {option.label}
                    </button>
                  );
                })}

                {options.length === 0 && (
                  <span className="text-xs text-muted-foreground">
                    {isLoading
                      ? t("loading")
                      : t("emptyRole", { role: ROLE_LABELS[role.code] ?? role.display })}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
