"use client";

import { Ban, Shield } from "lucide-react";
import { useTranslations } from "next-intl";

import type { AqtRoleKey } from "@/components/hero/heroRole";
import type { PickBanItemLike } from "@/components/pick-ban/PickBanGrid";
import { PickBanItemThumb } from "@/components/pick-ban/PickBanItemThumb";
import { cn } from "@/lib/utils";

/** One committed action of a round's hero ban phase, resolved against the catalog. */
export interface PregameHeroAction {
  itemId: number;
  /** Catalog name, or the room's `#id` fallback while it loads. */
  name: string;
  /** Undefined until the hero catalog resolves — the thumb falls back to initials. */
  item: PickBanItemLike | undefined;
  /** Only used to order a side's rows; null when the catalog knows no role. */
  role: AqtRoleKey | null;
  action: "ban" | "protect";
  /** The side that committed it. */
  side: "home" | "away";
}

/** Tank-damage-support, the order the game's own hero list uses. */
const ROLE_RANK: Record<AqtRoleKey, number> = { tank: 0, damage: 1, support: 2 };

const SIDE_ACCENT = {
  home: "--aqt-teal",
  away: "--aqt-rose"
} as const;

/**
 * The round's hero bans, on the screen where the map is played and reported.
 *
 * The room renders one phase at a time, so the moment the hero grid closes it
 * is gone — and that is exactly when the bans are needed, because they have to
 * be set up in the game lobby before the map starts. Without this the captains
 * had to memorise them (or reopen the room in another tab and read the finished
 * grid) with no screen left showing what was banned.
 *
 * Split by side, not by role: a round commits two to four actions in total, so
 * per-side grouping names who banned what once, in the same home/away geometry
 * (and the same teal/rose accents) as the score claims directly below. Within a
 * side the rows follow the game's role order, and a protect is marked with a
 * shield rather than mixed in as a ban — a protected hero must stay enabled.
 */
export function PregameHeroBans({
  actions,
  homeName,
  awayName,
  homeHue,
  awayHue
}: {
  actions: PregameHeroAction[];
  homeName: string;
  awayName: string;
  /** Crest hue per side, from `teamCrest` — null when the team is unknown. */
  homeHue: number | null;
  awayHue: number | null;
}) {
  const t = useTranslations("pickBan.room");

  if (actions.length === 0) {
    return null;
  }

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--aqt-rose)]">
          {t("heroBans.eyebrow")}
        </span>
        <p className="text-xs leading-relaxed text-[color:var(--aqt-fg-muted)]">
          {t("heroBans.hint")}
        </p>
      </div>
      {/* Stacked below `sm` for the same reason the claim row is: two columns of
          hero names on a phone truncate to initials. */}
      <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-2 sm:gap-4">
        <SideBans
          side="home"
          name={homeName}
          hue={homeHue}
          actions={actions.filter((action) => action.side === "home")}
        />
        <SideBans
          side="away"
          name={awayName}
          hue={awayHue}
          actions={actions.filter((action) => action.side === "away")}
        />
      </div>
    </section>
  );
}

/**
 * One side's committed actions. Rendered even when empty — a sequence can give
 * a side no ban this round, and a missing column would read as data still
 * loading rather than as nothing to transfer.
 */
function SideBans({
  side,
  name,
  hue,
  actions
}: {
  side: "home" | "away";
  name: string;
  hue: number | null;
  actions: PregameHeroAction[];
}) {
  const t = useTranslations("pickBan.room");
  const accent = `var(${SIDE_ACCENT[side]})`;
  const crestInitial = (name.match(/[\p{L}\p{N}]/u)?.[0] ?? "#").toUpperCase();
  const ordered = [...actions].sort(
    (left, right) =>
      (left.action === "ban" ? 0 : 1) - (right.action === "ban" ? 0 : 1) ||
      (left.role ? ROLE_RANK[left.role] : 3) - (right.role ? ROLE_RANK[right.role] : 3) ||
      left.name.localeCompare(right.name)
  );

  return (
    <div
      data-hero-bans={side}
      className="flex flex-col gap-1.5 rounded-xl border border-[color:var(--aqt-border)] bg-[color:var(--aqt-card-2)]/40 p-2.5"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          aria-hidden
          className="grid h-5 w-5 shrink-0 place-items-center rounded font-onest text-[10px] font-bold"
          style={
            hue != null
              ? { background: `hsl(${hue} 55% 22%)`, color: `hsl(${hue} 70% 72%)` }
              : { background: "var(--aqt-card-2)", color: "var(--aqt-fg-faint)" }
          }
        >
          {crestInitial}
        </span>
        <span
          title={name}
          className="min-w-0 truncate text-xs font-semibold"
          style={{ color: accent }}
        >
          {name}
        </span>
      </span>

      {ordered.length === 0 ? (
        <span className="px-0.5 py-1 text-xs text-[color:var(--aqt-fg-faint)]">
          {t("heroBans.none")}
        </span>
      ) : (
        <ul className="flex flex-col gap-1">
          {ordered.map((action) => {
            const banned = action.action === "ban";
            const Icon = banned ? Ban : Shield;
            return (
              <li
                key={`${action.action}-${action.itemId}`}
                data-hero-action={action.action}
                className="flex min-w-0 items-center gap-2"
              >
                <Icon
                  aria-hidden
                  className={cn(
                    "h-3.5 w-3.5 shrink-0",
                    banned ? "text-[color:var(--aqt-rose)]" : "text-[color:var(--aqt-amber)]"
                  )}
                />
                <PickBanItemThumb
                  kind="hero"
                  item={action.item}
                  name={action.name}
                  size={26}
                  muted={banned}
                />
                {/* The icon is decorative, so the state has to reach a screen
                    reader as text — it is the difference between "disable this"
                    and "leave this in". */}
                <span className="sr-only">{t(`heroBans.state.${action.action}`)}</span>
                <span
                  className={cn(
                    "min-w-0 truncate text-sm",
                    banned ? "font-semibold" : "font-medium text-[color:var(--aqt-fg-muted)]"
                  )}
                  title={action.name}
                >
                  {action.name}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
