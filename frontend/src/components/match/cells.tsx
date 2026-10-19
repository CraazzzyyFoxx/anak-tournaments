import { cn } from "@/lib/utils";

/**
 * Small match/encounter presentational primitives shared across pages
 * (player profile, encounters, teams). Styled with the global `aqt-*`
 * classes + `--aqt-*` tokens (promoted to :root), so they work anywhere.
 * A game's own placement/badge rules live in its discipline module.
 */

export type ResTagKind = "w" | "l" | "d";

export const ResTag = ({ kind, className }: { kind: ResTagKind; className?: string }) => (
  <span className={cn("aqt-res-tag", kind, className)}>{kind.toUpperCase()}</span>
);

export type ScoreKind = "win" | "loss" | "draw";

export const ScoreCell = ({
  kind,
  value,
  className
}: {
  kind: ScoreKind;
  value: string;
  className?: string;
}) => <span className={cn("aqt-score-cell", kind, className)}>{value}</span>;
