"use client";

import { GameScopeControl } from "@/components/workspace/GameScopeControl";
import { useGameScope } from "@/hooks/useGameScope";
import type { GameScopeInit, WorkspaceAxis } from "@/lib/site/discipline-scope";

/**
 * The game control of a server-rendered single page (spec §4.3): the local game tabs under "all games", or — when the
 * resolution is not a game — what the page shows instead of data: the invalid value named with the tabs as the way
 * out, or the "nothing enabled" state. A tab pick pushes `?discipline=`, which re-renders the server page.
 */
export function ServerGameTabs({
  initial,
  axis,
  className
}: Readonly<{ initial: GameScopeInit; axis?: WorkspaceAxis; className?: string }>) {
  const scope = useGameScope({ pageClass: "single", initial, axis });
  return <GameScopeControl scope={scope} variant="single" className={className} />;
}
