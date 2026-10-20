"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { GameTabs } from "@/components/workspace/GameTabs";
import { useGameScope } from "@/hooks/useGameScope";
import type { GameScopeInit, WorkspaceAxis } from "@/lib/site/discipline-scope";

/**
 * Local game tabs of one game-bound block inside a multi page (spec §4.3 note, §6.4). A pick writes only the last
 * game — a URL game would narrow the whole page — then re-renders the server blocks, which read that cookie.
 */
export function BlockGameTabs({
  initial,
  axis,
  className
}: Readonly<{ initial: GameScopeInit; axis?: WorkspaceAxis; className?: string }>) {
  const t = useTranslations("common.discipline");
  const router = useRouter();
  const scope = useGameScope({ pageClass: "single", initial, axis });
  if (!scope.resolution?.tabs || scope.game === null) return null;
  return (
    <GameTabs
      games={(scope.games ?? []).filter((game) => game.enabled)}
      value={scope.game}
      label={t("select")}
      className={className}
      onSelect={(code) => {
        scope.selectTab(code, { url: false });
        router.refresh();
      }}
    />
  );
}
