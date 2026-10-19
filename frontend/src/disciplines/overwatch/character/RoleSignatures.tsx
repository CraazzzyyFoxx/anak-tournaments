"use client";

import { useTranslations } from "next-intl";

import CatalogEntityImage from "@/components/catalog/CatalogEntityImage";
import type { SlotProps } from "@/disciplines/types";
import { characterClass } from "@/lib/catalog/attrs";
import { winrateColor } from "@/lib/colors";

import { LogStatsName } from "../stat-names";
import { useHeroClass } from "./classes";
import HeroUserStatsPopover from "./HeroUserStatsPopover";
import { getOverall, statAvg10, toFraction } from "./utils";

/**
 * Overwatch's signature hero per role on the overview's role split (the `roleSignatures` slot): the player's
 * most-played hero whose class is that role's code. An unassigned/flex bucket has no class and no signature.
 */
const RoleSignatures = ({ characters, games, roles, metadata }: SlotProps["roleSignatures"]) => {
  const t = useTranslations();
  const heroClass = useHeroClass(metadata);

  const signatures = roles.flatMap((code) => {
    const roleHeroes = characters.filter((h) => characterClass(h.character) === code);
    if (roleHeroes.length === 0) return [];
    const top = roleHeroes.reduce((best, h) =>
      getOverall(h, LogStatsName.HeroTimePlayed) > getOverall(best, LogStatsName.HeroTimePlayed) ? h : best
    );
    if (getOverall(top, LogStatsName.HeroTimePlayed) <= 0) return [];
    const winFrac = toFraction(statAvg10(top.stats, LogStatsName.Winrate));
    return [
      {
        code,
        top,
        games: games?.[top.character.id] ?? 0,
        kda: statAvg10(top.stats, LogStatsName.KDA),
        winPct: winFrac == null ? null : winFrac * 100
      }
    ];
  });
  if (signatures.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 border-t border-[color:var(--aqt-border)] pt-3.5">
      <span className="aqt-tnum text-label font-bold uppercase tracking-label text-[color:var(--aqt-fg-faint)]">
        {t("users.overview.roleSplit.signatureTitle")}
      </span>
      {signatures.map((sig) => {
        const roleName = heroClass.label(sig.code);
        const hero = sig.top.character;
        return (
          <div key={sig.code} className="grid grid-cols-[16px_26px_1fr_auto] items-center gap-2.5">
            <div className="flex justify-center" title={roleName}>
              {heroClass.icon(sig.code, 14)}
              <span className="sr-only">{roleName}</span>
            </div>
            <CatalogEntityImage
              entity={hero}
              size={26}
              title={hero.name}
              popover={<HeroUserStatsPopover entity={hero} stats={sig.top.stats} metadata={metadata} />}
            />
            <div className="min-w-0">
              <div className="truncate text-caption font-bold text-[color:var(--aqt-fg)]">{hero.name}</div>
              <div className="aqt-tnum text-label text-[color:var(--aqt-fg-dim)]">
                {games !== null && sig.games > 0 ? (
                  <>{t("users.overview.roleSplit.games", { count: sig.games })} · </>
                ) : null}
                {sig.kda != null ? t("users.overview.roleSplit.kda", { value: sig.kda.toFixed(2) }) : "—"}
              </div>
            </div>
            {/* Empty when the hero has no winrate sample: an `auto` track collapses to nothing, where a
                placeholder dash printed a column of three bare em dashes down the card. */}
            {sig.winPct != null ? (
              <div className="aqt-display aqt-tnum text-ui font-bold" style={{ color: winrateColor(sig.winPct) }}>
                {sig.winPct.toFixed(0)}%
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

export default RoleSignatures;
