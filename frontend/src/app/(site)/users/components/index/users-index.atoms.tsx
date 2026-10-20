"use client";

import { useTranslations } from "next-intl";
import type { RoleOntology } from "@/lib/roster/ontology";

import { HoverPrefetchLink } from "@/components/HoverPrefetchLink";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusDot } from "@/components/ui/status-dot";
import { formatRelative } from "@/components/kit/format-time";
import { GameMarkButton } from "@/components/workspace/GameMarkButton";
import { useGameDescriptors } from "@/hooks/useGameDescriptors";
import { useFormatter } from "@/lib/datetime/client";
import { winrateColor } from "@/lib/colors";
import { getPlayerSlug } from "@/lib/player";
import { cn, initials } from "@/lib/utils";
import type { UserOverviewRoleDivision } from "@/types/user.types";
import type { DivisionGridVersion } from "@/types/workspace.types";

import { DivisionHex } from "./DivisionHex";
import { gridForRole, isRecentlyActive, mapsWinratePct, splitTag } from "./users-index.model";

/** The minimum a surface needs to draw a player's identity. */
export interface PlayerIdentity {
  id: number;
  name: string;
  avatar_url: string | null;
}

export function PlayerAvatar({
  user,
  size = 32,
  className
}: Readonly<{ user: PlayerIdentity; size?: number; className?: string }>) {
  return (
    <Avatar className={cn("shrink-0 border border-[color:var(--aqt-border)]", className)} style={{ width: size, height: size }}>
      {user.avatar_url ? <AvatarImage src={user.avatar_url} alt="" /> : null}
      <AvatarFallback className="bg-[color:var(--aqt-overlay-3)] text-label font-bold text-[color:var(--aqt-fg-muted)]">
        {initials(user.name)}
      </AvatarFallback>
    </Avatar>
  );
}

/** `handle` as a profile link with a faint `#tag`. */
export function PlayerName({ name, className }: Readonly<{ name: string; className?: string }>) {
  const { handle, tag } = splitTag(name);
  return (
    <HoverPrefetchLink
      href={`/users/${getPlayerSlug(name)}`}
      title={name}
      className={cn(
        "truncate font-semibold text-[color:var(--aqt-fg)] transition-colors hover:text-[color:var(--aqt-teal)]",
        className
      )}
    >
      {handle}
      {tag ? <span className="font-normal text-[color:var(--aqt-fg-faint)]">{tag}</span> : null}
    </HoverPrefetchLink>
  );
}

/** "3 нед. назад", with a live dot only while the player is active this month. */
export function LastActive({ at, className }: Readonly<{ at: string | null; className?: string }>) {
  const t = useTranslations();
  const format = useFormatter();
  const recent = isRecentlyActive(at);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-label text-[color:var(--aqt-fg-faint)]",
        className
      )}
    >
      {recent ? <StatusDot className="text-[color:var(--aqt-emerald)]" /> : null}
      {at ? formatRelative(format, at) : t("users.list.table.neverPlayed")}
    </span>
  );
}

/** One crest per ranked role; an em-dash-free placeholder when unranked. */
export function RolesCrests({
  roles,
  grids,
  discipline,
  ontology,
  size = 30
}: Readonly<{
  roles: UserOverviewRoleDivision[];
  grids: DivisionGridVersion[] | undefined;
  /** The index's game and its role dictionary (`null` while either resolves). */
  discipline: string | null;
  ontology: RoleOntology | null;
  size?: number;
}>) {
  const t = useTranslations();
  if (roles.length === 0) {
    return (
      <span className="text-label text-[color:var(--aqt-fg-faint)]">
        {t("users.list.division.noRoles")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      {roles.map((role) => (
        <DivisionHex
          key={`${role.role?.dimension}-${role.role?.role}-${role.division}`}
          role={role.role}
          discipline={discipline}
          ontology={ontology}
          division={role.division}
          roleGrid={gridForRole(role, grids)}
          size={size}
        />
      ))}
    </span>
  );
}

/**
 * Map winrate as a plain coloured number with its sample size underneath — no
 * bar: a filled track reads as progress toward a goal, which a winrate is not.
 * Under `minEncounters` the number greys out instead of claiming a rank.
 * `record` adds the maps won–lost beside it (the cross-game row, spec §6.7).
 */
export function WinrateCell({
  user,
  minEncounters,
  align = "center",
  record = false
}: Readonly<{
  user: { maps_won: number; maps_lost: number; encounters_played: number };
  minEncounters: number;
  align?: "center" | "start";
  record?: boolean;
}>) {
  const t = useTranslations();
  const pct = mapsWinratePct(user);
  const lowSample = user.encounters_played < minEncounters;

  if (pct === null) {
    return (
      <span className="text-label text-[color:var(--aqt-fg-faint)]">
        {t("users.list.table.noLogs")}
      </span>
    );
  }

  return (
    <span className={cn("flex flex-col gap-0.5", align === "center" ? "items-center" : "items-start")}>
      <span className={cn("flex flex-wrap items-baseline gap-x-1.5", align === "center" && "justify-center")}>
        <span className="font-semibold tabular-nums" style={{ color: winrateColor(pct, lowSample) }}>
          {pct.toFixed(0)}%
        </span>
        {record ? (
          <span className="text-label tabular-nums text-[color:var(--aqt-fg-muted)]">
            {t("users.list.table.mapsRecord", { won: user.maps_won, lost: user.maps_lost })}
          </span>
        ) : null}
      </span>
      <span className="text-label tabular-nums text-[color:var(--aqt-fg-faint)]">
        {t("users.list.table.encounters", { count: user.encounters_played })}
      </span>
    </span>
  );
}

/** Compare checkbox; the third pick is disabled rather than silently ignored. */
export function CompareCheckbox({
  user,
  selected,
  disabled,
  onToggle
}: Readonly<{
  user: PlayerIdentity;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}>) {
  const t = useTranslations();
  return (
    <Checkbox
      checked={selected}
      disabled={disabled}
      onCheckedChange={onToggle}
      aria-label={t("users.list.compare.toggle", { name: user.name })}
      title={disabled ? t("users.list.compare.limit") : undefined}
    />
  );
}

/** The games a player played, each a mark that narrows the scope to it (spec §6.7). */
export function GameMarks({
  codes,
  onSelect
}: Readonly<{ codes: readonly string[]; onSelect: (code: string) => void }>) {
  const games = useGameDescriptors();
  return (
    <span className="inline-flex items-center justify-center gap-1">
      {codes.map((code) => {
        const game = games.get(code);
        return game ? <GameMarkButton key={code} discipline={game} onSelect={onSelect} size={18} /> : null;
      })}
    </span>
  );
}
