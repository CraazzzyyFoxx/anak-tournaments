"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useDisciplines } from "@/hooks/useDisciplineMetadata";
import {
  ALL_DISCIPLINES,
  DISCIPLINE_PARAM,
  disciplineParamOf,
  resolveDiscipline,
  resolveWorkspaceAxis,
  type BrowsingDisciplineInit,
  type ResolvedDiscipline,
  type WorkspaceAxis
} from "@/lib/site/discipline-scope";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { DisciplineDescriptor } from "@/types/discipline.types";

export interface BrowsingDisciplineState {
  axis: WorkspaceAxis;
  disciplines: DisciplineDescriptor[] | undefined;
  /** `null` until the installed games are known; invalid/empty resolutions make no game request. */
  resolved: ResolvedDiscipline | null;
  isError: boolean;
  refetch: () => void;
  /** A user pick: saved as the preference and pushed as a history entry on the shareable URL. */
  select: (value: string) => void;
}

const noSubscription = () => () => {};

/**
 * The browsing discipline of a concrete-browsing or directory surface (§2.3/§2.4):
 * valid `?discipline=` over the saved choice over the first enabled game, shown in the
 * URL. The URL is canonicalized with `replace` when the choice came from the cookie or
 * default — never overwritten the other way round, and an invalid explicit value stays
 * as typed so the surface can show it.
 *
 * Until mounted the server's own inputs (`initial`) drive the resolution, so hydration
 * matches the server render even though the client store reads the cookie at creation.
 */
export function useBrowsingDiscipline({
  allowsAll,
  initial,
  axis: axisOverride
}: Readonly<{
  allowsAll: boolean;
  initial?: BrowsingDisciplineInit;
  /** A surface that is platform-wide whatever the viewing scope (e.g. the global catalog admin) names its axis. */
  axis?: WorkspaceAxis;
}>): BrowsingDisciplineState {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);

  const storeHostLock = useWorkspaceStore((s) => s.hostLockedWorkspaceId);
  const statsScope = useWorkspaceStore((s) => s.statsScope);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const storeStored = useWorkspaceStore((s) => s.browsingDiscipline);
  const setBrowsingDiscipline = useWorkspaceStore((s) => s.setBrowsingDiscipline);

  const stored = mounted || !initial ? storeStored : initial.stored;
  const viewed =
    mounted || !initial
      ? resolveWorkspaceAxis({
          hostLockedWorkspaceId: storeHostLock ?? initial?.hostLockedWorkspaceId ?? null,
          ownerWorkspaceId: null,
          statsScope,
          currentWorkspaceId
        })
      : initial.axis;
  // A tenant host's workspace is authoritative: a platform-wide override never widens it.
  const tenantLock = storeHostLock ?? initial?.hostLockedWorkspaceId ?? null;
  const axis = tenantLock ?? axisOverride ?? viewed;

  const list = useDisciplines(axis, initial?.axis === axis ? (initial.disciplines ?? undefined) : undefined);
  const disciplines = list.data;
  // `?discipline=` with no value is an explicit (invalid) request, not an absent one.
  const explicit = searchParams.get(DISCIPLINE_PARAM);

  const resolved = disciplines
    ? resolveDiscipline({
        ownerDiscipline: null,
        explicitDiscipline: explicit,
        storedDiscipline: stored,
        disciplines,
        allowsAll
      })
    : null;

  const urlValue = resolved && explicit === null ? disciplineParamOf(resolved) : null;
  useEffect(() => {
    if (urlValue === null) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set(DISCIPLINE_PARAM, urlValue);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [urlValue, pathname, router, searchParams]);

  // A saved choice the installed/enabled set cannot honour is dropped, not kept dormant.
  const storedUsable =
    stored === null || stored === ALL_DISCIPLINES || disciplines?.some((d) => d.code === stored && d.enabled) !== false;
  useEffect(() => {
    if (!storedUsable && mounted) setBrowsingDiscipline(null);
  }, [storedUsable, mounted, setBrowsingDiscipline]);

  const select = useCallback(
    (value: string) => {
      setBrowsingDiscipline(value);
      const next = new URLSearchParams(searchParams.toString());
      next.set(DISCIPLINE_PARAM, value);
      next.delete("page");
      router.push(`${pathname}?${next.toString()}`);
    },
    [pathname, router, searchParams, setBrowsingDiscipline]
  );

  return { axis, disciplines, resolved, isError: list.isError, refetch: () => void list.refetch(), select };
}
