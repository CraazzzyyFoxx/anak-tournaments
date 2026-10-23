"use client";

import { GameScopeControl } from "@/components/workspace/GameScopeControl";
import { useGameScope } from "@/hooks/useGameScope";
import type { GameScopeInit, WorkspaceAxis } from "@/lib/site/discipline-scope";

/**
 * A server-rendered multi page's game notice (spec §4.1): the invalid explicit game with "Show all games", or the
 * area's empty state. Nothing otherwise — the pill is the page's game control.
 */
export function ServerGameScopeNotice({ initial, axis }: Readonly<{ initial: GameScopeInit; axis?: WorkspaceAxis }>) {
  return <GameScopeControl scope={useGameScope({ pageClass: "multi", initial, axis })} variant="multi" />;
}
