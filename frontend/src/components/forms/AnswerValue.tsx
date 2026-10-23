"use client";

import type { ReactNode } from "react";
import { Check, ExternalLink, Minus } from "lucide-react";
import { useFormatter } from "@/lib/datetime/client";

import DivisionIcon from "@/components/DivisionIcon";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { useRoleName } from "@/hooks/useRoleName";
import { resolveDivisionFromRank } from "@/lib/divisions/grid";
import { findRole, ratedDimension, type LadderedOntology, type RoleOntology } from "@/lib/roster/ontology";
import type { RoleRef } from "@/lib/roster/team-format";
import { cn } from "@/lib/utils";
import type { FieldKind } from "@/types/forms.types";
import type { DivisionGrid } from "@/types/workspace.types";

/**
 * One stored answer, rendered for a table cell or an inspector row.
 *
 * Shared by the public participants roster, the admin registrations table and
 * the live draft's player inspector: all three read the same flat `answers`
 * document off the same schema, and a second copy of this switch would drift
 * the moment a kind is added.
 *
 * The boolean wording is passed in rather than translated here: the admin table
 * renders plain English while the public roster is localized, and next-intl's
 * translator type is keyed on the message catalogue so it cannot be widened to
 * a plain `(key: string) => string`. Dates have no such problem and go through
 * `useFormatter()`, so every zone prints them in the app's locale.
 */
export interface AnswerValueProps {
  value: unknown;
  /** The field's kind. Omit for a value whose field is unknown (a stale answer). */
  kind?: FieldKind;
  labels?: { yes: string; no: string };
  /**
   * The owner game's role dictionary and native ladder. Required, `null` while
   * it loads: a `role_ranks` answer is keyed by role code (without the
   * dictionary every glyph is "unknown role" and every name the bare code) and
   * holds a rank on that game's own scale, so its crest comes off the native
   * ladder, never a workspace grid that would rename the number under it.
   */
  ontology: LadderedOntology | null;
}

const EMPTY = <span className="text-[color:var(--aqt-fg-dim)]">&mdash;</span>;

const MUTED = "text-[color:var(--aqt-fg-muted)]";

const CHIP =
  "inline-flex items-center rounded-md border border-[color:var(--aqt-border-2)] " +
  "bg-[color:var(--aqt-overlay-3)] px-1.5 py-0.5 text-xs font-medium text-[color:var(--aqt-fg-muted)]";

export interface RoleRankEntry {
  role: RoleRef | string;
  /** As stored. `null` = declared, not ranked yet: shown as a dash. */
  rank: unknown;
  /** Sub-role label, printed beside the glyph. */
  subrole?: string | null;
  /** Declared but not playable. */
  dimmed?: boolean;
}

/**
 * Role ranks as a spaced row: role glyph, division crest, SR. The glyph and the
 * crest carry the role and division names for assistive tech, so the number is
 * the only text — the same reading the roster's roles column gives. Shared by
 * `role_ranks` answers and the registration inspector's declared roles.
 *
 * `grid` is the caller's owner-native rank scale. Without one no crest is invented.
 */
export function RoleRankList({
  entries,
  grid,
  ontology,
}: Readonly<{ entries: readonly RoleRankEntry[]; grid?: DivisionGrid; ontology?: RoleOntology | null }>) {
  // The glyph's own title goes through the same hook; the raw `name` printed
  // "Tank" beside a glyph titled "Танк".
  const nameOf = useRoleName();
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {entries.map((entry, index) => {
        const missing = entry.rank == null || entry.rank === "";
        const sr = missing ? Number.NaN : Number(entry.rank);
        const division = grid && Number.isFinite(sr) ? resolveDivisionFromRank(grid, sr) : null;
        const ref = typeof entry.role === "string" ? { dimension: ontology ? ratedDimension(ontology)?.code ?? "" : "", role: entry.role } : entry.role;
        const role = ontology ? findRole(ontology, ref) : null;
        const label = role ? nameOf(role) : ref.role;
        return (
          <span
            key={`${ref.dimension}:${ref.role}-${index}`}
            className={cn("inline-flex items-center gap-1 text-xs font-medium", MUTED, entry.dimmed && "opacity-60")}
          >
            <PlayerRoleIcon role={ref} ontology={ontology} size={14} />
            <span>{label}</span>
            {entry.subrole ? (
              <span className="text-[color:var(--aqt-fg-dim)]">{entry.subrole}</span>
            ) : null}
            {division != null ? (
              <DivisionIcon
                division={division}
                tournamentGrid={grid}
                discipline={ontology?.discipline.code}
                width={18}
                height={18}
                className="shrink-0"
              />
            ) : null}
            {missing ? EMPTY : <span className="tabular-nums">{String(entry.rank)}</span>}
          </span>
        );
      })}
    </span>
  );
}

export function AnswerValue({
  value,
  kind,
  labels = { yes: "Yes", no: "No" },
  ontology,
}: Readonly<AnswerValueProps>): ReactNode {
  const format = useFormatter();
  if (value === null || value === undefined || value === "") return EMPTY;
  if (Array.isArray(value)) {
    if (value.length === 0) return EMPTY;
    return (
      <span className="flex flex-wrap gap-1">
        {value.map((item) => (
          <span key={String(item)} className={CHIP}>
            {String(item)}
          </span>
        ))}
      </span>
    );
  }

  // Stored role-rank answers keep their code keys. Ordering comes only from the scoped dictionary.
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, rank]) => rank !== null && rank !== undefined && rank !== "")
      .sort(([a], [b]) => {
        const roles = ontology?.roles ?? [];
        const dimension = ontology ? ratedDimension(ontology)?.code : undefined;
        const left = roles.findIndex(role => role.dimension === dimension && role.code === a);
        const right = roles.findIndex(role => role.dimension === dimension && role.code === b);
        return (left < 0 ? Infinity : left) - (right < 0 ? Infinity : right) || a.localeCompare(b);
      });
    if (entries.length === 0) return EMPTY;
    // A game without a native ladder serves an empty one: no crest, none borrowed.
    const nativeLadder = ontology?.native_ladder.length ? { tiers: [...ontology.native_ladder] } : undefined;
    return (
      <RoleRankList entries={entries.map(([role, rank]) => ({ role, rank }))} grid={nativeLadder} ontology={ontology} />
    );
  }

  // A checkbox that round-tripped through a form encoding arrives as the string
  // `"false"`, which must read as No rather than as a truthy non-empty string.
  if (typeof value === "boolean" || kind === "checkbox") {
    const on = value !== false && value !== "false";
    return (
      <span className={`inline-flex items-center gap-1 ${MUTED}`}>
        {on ? (
          <Check className="size-3.5 text-[color:var(--aqt-emerald)]" aria-hidden />
        ) : (
          <Minus className="size-3.5" aria-hidden />
        )}
        {on ? labels.yes : labels.no}
      </span>
    );
  }

  if (kind === "url") {
    return (
      <a
        href={String(value)}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center gap-1 ${MUTED} underline decoration-[color:var(--aqt-border-3)] hover:text-[color:var(--aqt-fg)]`}
      >
        <span className="max-w-[120px] truncate">{String(value)}</span>
        <ExternalLink className="size-3 shrink-0" aria-hidden />
      </a>
    );
  }

  if (kind === "date") {
    // An unparseable answer is shown verbatim: a stored string the organizer
    // can see is more useful than "Invalid Date". A date answer is a bare
    // "YYYY-MM-DD", which parses as UTC midnight — so it is printed in UTC.
    const parsed = new Date(String(value));
    const text = Number.isNaN(parsed.getTime())
      ? String(value)
      : format.dateTime(parsed, { dateStyle: "medium", timeZone: "UTC" });
    return <span className={MUTED}>{text}</span>;
  }

  if (kind === "select") return <span className={CHIP}>{String(value)}</span>;

  return <span className={MUTED}>{String(value)}</span>;
}
