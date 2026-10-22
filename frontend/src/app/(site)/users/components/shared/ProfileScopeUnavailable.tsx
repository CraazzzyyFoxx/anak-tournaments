"use client";

import { GameScopeControl } from "@/components/workspace/GameScopeControl";
import { useGameScope } from "@/hooks/useGameScope";
import type { GameScopeInit } from "@/lib/site/discipline-scope";

/** The page names an unknown/disabled game, or the area runs none: the scope's own unavailable state (spec §4.1). */
export default function ProfileScopeUnavailable({ initial }: Readonly<{ initial: GameScopeInit }>) {
  const scope = useGameScope({ pageClass: "multi", initial });
  return <GameScopeControl scope={scope} variant="multi" headingLevel={1} />;
}
