"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import { useHubTournamentQuery } from "../hubQueries";
import {
  MATCHES_DEFAULT_SUB_TAB,
  MATCHES_SUB_TAB_KEYS,
  allowedMatchesSubTab,
  isMatchesSubTab,
  type MatchesSubTab
} from "../tab-guards";

const SUB_TAB_LABELS: Record<MatchesSubTab, string> = {
  results: "Results",
  reports: "Reports",
  maps: "Maps",
  logs: "Logs"
};

/**
 * Sub-tab bar for the Play & Results hub tab.
 *
 * Deliberately not the shadcn `Tabs` used by the outer hub bar: nesting a
 * second `Tabs` root inside the first makes two roving-tabindex groups fight
 * over arrow keys. This is a plain nav with links, so keyboard users tab
 * through it once and screen readers announce one list.
 */
export default function MatchesLayout({ children }: Readonly<{ children: ReactNode }>) {
  const params = useParams<{ id: string }>();
  const tournamentId = Number(params.id);
  const pathname = usePathname();
  const router = useRouter();
  const { canAccessPermission, isLoaded: permissionsLoaded } = usePermissions();

  const basePath = `/admin/tournaments/${tournamentId}/matches`;
  const segment = pathname.startsWith(basePath)
    ? (pathname.slice(basePath.length).split("/").find(Boolean) ?? MATCHES_DEFAULT_SUB_TAB)
    : MATCHES_DEFAULT_SUB_TAB;
  const active: MatchesSubTab = isMatchesSubTab(segment) ? segment : MATCHES_DEFAULT_SUB_TAB;

  const tournamentQuery = useHubTournamentQuery(tournamentId);
  const workspaceId = tournamentQuery.data?.workspace_id ?? null;
  const access = { canReadMatch: canAccessPermission("match.read", workspaceId) };
  const activeAllowed = allowedMatchesSubTab(active, access);

  // Same contract as the outer hub guard: a direct URL hit on a sub-tab the
  // caller may not open bounces to the landing segment. Decided only once
  // permissions and the tournament are in, or an unresolved permission set
  // would bounce a legitimate visitor on first paint.
  useEffect(() => {
    if (!permissionsLoaded || !tournamentQuery.data) return;
    if (!activeAllowed) {
      router.replace(`${basePath}/${MATCHES_DEFAULT_SUB_TAB}`);
    }
  }, [permissionsLoaded, tournamentQuery.data, activeAllowed, basePath, router]);

  const visible = MATCHES_SUB_TAB_KEYS.filter((key) => allowedMatchesSubTab(key, access));

  return (
    <div className="space-y-4">
      {visible.length > 1 ? (
        <nav
          aria-label="Play & Results sections"
          className="flex flex-wrap gap-1 border-b border-[color:var(--aqt-border)]"
        >
          {visible.map((key) => {
            const isActive = key === active;
            return (
              <Link
                key={key}
                href={`${basePath}/${key}`}
                aria-current={isActive ? "page" : undefined}
                className={[
                  "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  // Never colour-only: the active section also carries a border
                  // and aria-current, so the state survives a greyscale render.
                  isActive
                    ? "border-[color:var(--aqt-fg)] text-[color:var(--aqt-fg)]"
                    : "border-transparent text-[color:var(--aqt-fg-muted)] hover:text-[color:var(--aqt-fg)]"
                ].join(" ")}
              >
                {SUB_TAB_LABELS[key]}
              </Link>
            );
          })}
        </nav>
      ) : null}
      {activeAllowed ? children : null}
    </div>
  );
}
