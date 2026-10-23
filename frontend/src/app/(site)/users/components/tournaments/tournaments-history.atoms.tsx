import React from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { SummaryCellBox } from "@/components/profile/atoms";

// ─── Master-detail (Event dossier) atoms ────────────────────────────────────────

/** W-D-L record as coloured mono text. Draws are hidden when zero. */
export const WdlText = ({
  won,
  lost,
  draw,
  className
}: {
  won: number;
  lost: number;
  draw: number;
  className?: string;
}) => {
  const t = useTranslations();
  return (
    <span className={cn("aqt-tnum aqt-tnum", className)}>
      <span style={{ color: "var(--aqt-emerald)" }}>{t("users.tournaments.stat.wins", { count: String(won) })}</span>{" "}
      <span style={{ color: "var(--aqt-rose)" }}>{t("users.tournaments.stat.losses", { count: String(lost) })}</span>
      {draw > 0 ? (
        <>
          {" "}
          <span style={{ color: "var(--aqt-amber)" }}>{t("users.tournaments.stat.draws", { count: String(draw) })}</span>
        </>
      ) : null}
    </span>
  );
};

/** Thin stacked W-D-L bar (win / draw / loss segments). */
export const WdlBar = ({
  won,
  lost,
  draw,
  className
}: {
  won: number;
  lost: number;
  draw: number;
  className?: string;
}) => {
  const total = won + lost + draw;
  return (
    <span className={cn("inline-flex h-[5px] w-16 overflow-hidden rounded-full bg-[color:var(--aqt-card-2)]", className)}>
      {total > 0 ? (
        <>
          <span style={{ width: `${(won / total) * 100}%`, background: "var(--aqt-emerald)" }} />
          <span style={{ width: `${(draw / total) * 100}%`, background: "var(--aqt-amber)" }} />
          <span style={{ width: `${(lost / total) * 100}%`, background: "var(--aqt-rose)" }} />
        </>
      ) : null}
    </span>
  );
};

export interface SummaryCell {
  key: string;
  label: string;
  value: React.ReactNode;
  color?: string;
}

/** Open hairline summary strip — top+bottom border only, cells hairline-divided; `extra` is a game module's
 *  own trailing cell (or nothing). Scrolls horizontally inside its own container on narrow screens (§7). */
export const SummaryStrip = ({ cells, extra }: { cells: SummaryCell[]; extra?: React.ReactNode }) => (
  <div className="overflow-x-auto border-y border-[color:var(--aqt-border)]">
    <div className="grid min-w-[540px] auto-cols-fr grid-flow-col">
      {cells.map((cell) => (
        <SummaryCellBox key={cell.key} label={cell.label} value={cell.value} color={cell.color} />
      ))}
      {extra}
    </div>
  </div>
);
