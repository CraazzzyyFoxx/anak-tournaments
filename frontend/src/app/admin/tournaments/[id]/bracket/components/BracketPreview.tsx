"use client";

import { Fragment } from "react";

import { EYEBROW_CLASS, TONE_TEXT } from "@/components/admin/tone";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type { BracketTeamCountSource, StageProjection } from "../projection";

const COUNT_SOURCE_NOTE: Record<BracketTeamCountSource, string> = {
  seeded: "from the teams already seeded into this stage",
  slots: "from the empty slots wired into this stage",
  projected: "projected from the preceding group stage's advancing count",
  unknown: "no seeds, slots or upstream group stage yet — depth falls back to Swiss max rounds"
};

/**
 * The stage as it would be generated right now — read only.
 *
 * The maths lives in `../projection.ts` (and, under it, in `@/lib/best-of`,
 * mirrored from `services/bracket/*`). This component only renders it, which
 * is why the numbers here and the rows the best-of editor offers cannot drift:
 * both read the same projection.
 *
 * Matches are NOT editable here. Editing them is the Matches tab's job, and
 * the Items section carries the cross-link.
 */
export function BracketPreview({
  projection,
  className
}: Readonly<{ projection: StageProjection; className?: string }>) {
  const { bracketTeams, rounds, unresolved } = projection;
  const sections: { label: string | null; rounds: StageProjection["rounds"] }[] = [];
  for (const round of rounds) {
    const last = sections[sections.length - 1];
    if (last && last.label === round.section) last.rounds.push(round);
    else sections.push({ label: round.section, rounds: [round] });
  }

  return (
    <section
      aria-labelledby="bracket-preview-heading"
      className={cn("rounded-lg border border-border bg-card p-4", className)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="bracket-preview-heading" className="text-sm font-semibold text-foreground">
          Bracket preview
        </h3>
        <p className={EYEBROW_CLASS}>read-only projection</p>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        <span className="tabular-nums">{projection.itemCount}</span> item
        {projection.itemCount === 1 ? "" : "s"} ·{" "}
        <span className={cn("tabular-nums", unresolved > 0 && TONE_TEXT.warning)}>
          {unresolved}
        </span>{" "}
        unresolved slot{unresolved === 1 ? "" : "s"} ·{" "}
        <span className="tabular-nums">
          {projection.assigned}/{projection.slots}
        </span>{" "}
        seeded
      </p>

      {projection.isBracket ? (
        <p className="mt-3 text-sm text-foreground">
          <span className="font-medium tabular-nums">{bracketTeams.count}</span> team
          {bracketTeams.count === 1 ? "" : "s"}{" "}
          <span className="text-muted-foreground">— {COUNT_SOURCE_NOTE[bracketTeams.source]}</span>
        </p>
      ) : null}

      {projection.isBracket && projection.seeds.lower > 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Upstream seeds: <span className="tabular-nums">{projection.seeds.upper}</span> upper ·{" "}
          <span className="tabular-nums">{projection.seeds.lower}</span> lower
        </p>
      ) : null}

      {projection.isGroups ? (
        <p className="mt-3 text-sm text-foreground">
          <span className="font-medium tabular-nums">{projection.itemCount}</span> group
          {projection.itemCount === 1 ? "" : "s"}
          {projection.advanceCount ? (
            <span className="text-muted-foreground">
              {" "}
              — top <span className="tabular-nums">{projection.advanceCount}</span> of each advance,{" "}
              <span className="tabular-nums">{projection.advancingTotal}</span> teams onward
            </span>
          ) : (
            <span className="text-muted-foreground">
              {" "}
              — advancing count auto-derived from the bracket wiring
            </span>
          )}
        </p>
      ) : null}

      <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
        {sections.map((section, index) => (
          <Fragment key={section.label ?? `flat-${index}`}>
            {section.label ? <p className={EYEBROW_CLASS}>{section.label}</p> : null}
            <ul className="flex flex-wrap gap-1.5">
              {section.rounds.map((round) => (
                <li key={round.round}>
                  <Badge variant="outline" className="gap-1.5 font-normal">
                    <span>{round.label}</span>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      Bo{round.bestOf}
                    </span>
                  </Badge>
                </li>
              ))}
            </ul>
          </Fragment>
        ))}
      </div>
    </section>
  );
}
