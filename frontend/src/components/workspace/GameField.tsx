"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { GameMark } from "@/components/workspace/GameMark";
import type { DisciplineDescriptor } from "@/types/discipline.types";

/**
 * A creation form's "Game" field (spec §7.2): one radio per enabled game. The caller passes the
 * default (`defaultCreationGame`) and locks the field once the entity exists. Only a different game
 * is reported: pressing the checked one again is no pick, so whatever the form keeps per game stays.
 */
export function GameField({
  games,
  value,
  onChange,
  disabled,
  id
}: Readonly<{
  games: DisciplineDescriptor[];
  value: string | null;
  onChange: (code: string) => void;
  disabled?: boolean;
  id?: string;
}>) {
  const t = useTranslations("common.discipline");
  const labelId = useId();

  return (
    <div className="space-y-1.5">
      <p id={labelId} className="text-sm font-medium">
        {t("field")}
      </p>
      <div id={id}>
        <ToggleGroup
          type="single"
          variant="pill"
          value={value ?? undefined}
          onValueChange={(code) => code && code !== value && onChange(code)}
          aria-labelledby={labelId}
        >
          {games
            .filter((game) => game.enabled)
            .map((game) => (
              <ToggleGroupItem key={game.code} value={game.code} disabled={disabled} className="gap-1.5">
                <GameMark discipline={game} size={16} decorative />
                {game.name}
              </ToggleGroupItem>
            ))}
        </ToggleGroup>
      </div>
    </div>
  );
}
