"use client";

import { useTranslations } from "next-intl";

import { PickBanItemThumb } from "@/components/pick-ban/PickBanItemThumb";
import type { SlotProps } from "@/disciplines/types";
import { playedCharacters } from "./view";

/** The heroes one player played on a map: portraits with names, or the empty line when they played none. */
export default function MatchCharacters({ match, userId }: Readonly<SlotProps["matchCharacters"]>) {
  const t = useTranslations("pickBan.room.playerHeroes");
  const heroes = playedCharacters(match, userId);

  if (heroes.length === 0) {
    return <p className="text-xs text-[color:var(--aqt-fg-muted)]">{t("empty")}</p>;
  }
  return (
    <ul
      aria-label={t("title")}
      tabIndex={0}
      className="flex max-h-32 flex-wrap gap-2 overflow-y-auto"
    >
      {heroes.map((hero) => (
        <li
          key={hero.id}
          className="flex max-w-full items-center gap-2 rounded-lg bg-[color:var(--aqt-card-2)] px-2 py-1.5"
        >
          <PickBanItemThumb kind="hero" item={hero} name={hero.name} size={24} />
          <span className="min-w-0 break-words text-xs font-medium text-[color:var(--aqt-fg)]">
            {hero.name}
          </span>
        </li>
      ))}
    </ul>
  );
}
