"use client";

import { DisciplineSelector, DisciplineUnavailable } from "@/components/workspace/DisciplineSelector";
import { useBrowsingDiscipline } from "@/hooks/useBrowsingDiscipline";
import type { BrowsingDisciplineInit, WorkspaceAxis } from "@/lib/site/discipline-scope";

/**
 * The game control of a server-rendered concrete-browsing page (§2.3/§2.4). It runs the client resolver on the
 * server's inputs, so it canonicalizes a cookie/default choice into the URL like every client surface, offers the
 * selector for a resolved game, and — when the resolution is not a game — is what the page shows instead of data:
 * the invalid value named with the way out, or the "nothing enabled" state.
 */
export function ServerBrowsingDiscipline({
  initial,
  axis,
  className
}: Readonly<{ initial: BrowsingDisciplineInit; axis?: WorkspaceAxis; className?: string }>) {
  const { disciplines, resolved, select } = useBrowsingDiscipline({ allowsAll: false, initial, axis });
  if (!disciplines || !resolved) return null;
  if (resolved.kind === "invalid" || resolved.kind === "empty") {
    return <DisciplineUnavailable resolved={resolved} disciplines={disciplines} allowsAll={false} onSelect={select} />;
  }
  if (resolved.kind !== "concrete") return null;
  return (
    <DisciplineSelector
      disciplines={disciplines}
      value={resolved.code}
      allowsAll={false}
      onSelect={select}
      className={className}
    />
  );
}
