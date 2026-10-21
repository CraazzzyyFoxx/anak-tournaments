const MEDAL: Record<number, string> = {
  1: "bg-[color:var(--aqt-medal-gold)] text-[color:var(--aqt-medal-gold-fg)]",
  2: "bg-[color:var(--aqt-medal-silver)] text-[color:var(--aqt-medal-silver-fg)]",
  3: "bg-[color:var(--aqt-medal-bronze)] text-[color:var(--aqt-medal-bronze-fg)]"
};

/** The place on the board: a medal chip for the podium, a faint number after it. */
const RankBadge = ({ rank }: Readonly<{ rank: number }>) =>
  MEDAL[rank] ? (
    <span className={`inline-grid size-[22px] place-items-center rounded-md text-label font-bold tabular-nums ${MEDAL[rank]}`}>
      {rank}
    </span>
  ) : (
    <span className="inline-block w-[22px] text-center text-label font-semibold tabular-nums text-[color:var(--aqt-fg-faint)]">
      {rank}
    </span>
  );

export default RankBadge;
