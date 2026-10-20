"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { GameTabs } from "@/components/workspace/GameTabs";
import { useGameScope } from "@/hooks/useGameScope";
import type { GameScopeInit } from "@/lib/site/discipline-scope";

/**
 * Local game tabs over the games the player played (spec §6.6), for the profile tabs that read one game under
 * "all games". A pick writes the last game only — a URL game would narrow the whole page — and re-reads the server
 * view, which resolves the same game from that cookie (`blockGameOf`). Absent with one game played, and while a valid
 * `?discipline=` fixes the page's game (the page then shows that game only).
 */
export default function ProfileGameTabs({ initial, games }: Readonly<{ initial: GameScopeInit; games: string[] }>) {
  const t = useTranslations("common.discipline");
  const router = useRouter();
  const scope = useGameScope({
    pageClass: "single",
    initial,
    filter: (all) => games.flatMap((code) => all.filter((entry) => entry.code === code))
  });
  const { resolution } = scope;
  if (!resolution?.tabs || resolution.game.kind !== "game" || resolution.game.source === "url" || !scope.games) {
    return null;
  }
  return (
    <GameTabs
      games={scope.games}
      value={resolution.game.code}
      label={t("select")}
      onSelect={(code) => {
        scope.selectTab(code, { url: false });
        router.refresh();
      }}
      className="mb-3.5"
    />
  );
}
