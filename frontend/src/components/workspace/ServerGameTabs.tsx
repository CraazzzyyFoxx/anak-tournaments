"use client";

import { usePathname, useRouter } from "next/navigation";

import { GameScopeControl } from "@/components/workspace/GameScopeControl";
import { useGameScope } from "@/hooks/useGameScope";
import { pageClassOf, type GameScopeInit, type WorkspaceAxis } from "@/lib/site/discipline-scope";

/**
 * The game control of a server-rendered single page or block (spec §4.3): the local game tabs under "all games", or —
 * when the resolution is not a game — what the page shows instead of data: the invalid value named with its way out,
 * or the "nothing enabled" state. On a single page a tab pick pushes `?discipline=`, which re-renders the server page.
 * A block on a multi page (the home leaders, a community's own-host home) never narrows the page's URL: a pick writes
 * only the last game and refreshes the server render, which reads it back; an invalid URL game gets the multi way out.
 */
export function ServerGameTabs({
  initial,
  axis,
  className
}: Readonly<{ initial: GameScopeInit; axis?: WorkspaceAxis; className?: string }>) {
  const router = useRouter();
  const block = pageClassOf(usePathname()) !== "single";
  const scope = useGameScope({ pageClass: "single", initial, axis });
  const control = block
    ? {
        ...scope,
        selectTab: (code: string) => {
          scope.selectTab(code, { url: false });
          router.refresh();
        }
      }
    : scope;
  return <GameScopeControl scope={control} variant={block ? "multi" : "single"} className={className} />;
}
