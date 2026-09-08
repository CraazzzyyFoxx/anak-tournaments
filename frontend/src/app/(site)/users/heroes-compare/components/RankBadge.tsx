interface RankBadgeProps {
  rank: number;
}

const BASE = "block text-center tabular-nums";

const RankBadge = ({ rank }: RankBadgeProps) => {
  if (rank === 1)
    return (
      <span className={`${BASE} font-[family-name:var(--aqt-display)] text-ui font-extrabold text-[color:var(--aqt-medal-gold)]`}>
        1
      </span>
    );
  if (rank === 2)
    return (
      <span className={`${BASE} font-[family-name:var(--aqt-data)] text-label font-bold text-[color:var(--aqt-medal-silver)]`}>
        2
      </span>
    );
  if (rank === 3)
    return (
      <span className={`${BASE} font-[family-name:var(--aqt-data)] text-label font-bold text-[color:var(--aqt-medal-bronze)]`}>
        3
      </span>
    );
  return (
    <span className={`${BASE} font-[family-name:var(--aqt-data)] text-label font-semibold text-[color:var(--aqt-fg-faint)]`}>
      {rank}
    </span>
  );
};

export default RankBadge;
