"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { DisciplineUnavailable } from "@/components/workspace/DisciplineUnavailable";
import { GameTabs } from "@/components/workspace/GameTabs";
import type { GameScopeState } from "@/hooks/useGameScope";
import { ALL_DISCIPLINES } from "@/lib/site/discipline-scope";

/**
 * What a game-scoped surface shows besides its data (spec §4.1, §4.3): the invalid or empty state with its way out —
 * "Показать все игры" on a multi page, the game tabs on a single or platform one — or the local game tabs when the
 * resolution asks for them. Nothing while the games are unknown, nor when the page's game needs no control.
 */
export function GameScopeControl({
  scope,
  variant,
  dropParams,
  className
}: Readonly<{ scope: GameScopeState; variant: "multi" | "single"; dropParams?: string[]; className?: string }>) {
  const t = useTranslations("common.discipline");
  const { resolution, games } = scope;
  if (!resolution || !games) return null;
  const tabs = (value: string) => (
    <GameTabs
      games={games}
      value={value}
      onSelect={(code) => scope.selectTab(code, { dropParams })}
      label={t("select")}
      className={className}
    />
  );
  const { game } = resolution;
  if (game.kind === "empty") return <DisciplineUnavailable game={game} />;
  if (game.kind === "invalid") {
    return (
      <DisciplineUnavailable
        game={game}
        action={
          variant === "multi" ? (
            <Button variant="outline" onClick={() => scope.selectScope(ALL_DISCIPLINES, { dropParams })}>
              {t("showAll")}
            </Button>
          ) : (
            tabs("")
          )
        }
      />
    );
  }
  return resolution.tabs && game.kind === "game" ? tabs(game.code) : null;
}
