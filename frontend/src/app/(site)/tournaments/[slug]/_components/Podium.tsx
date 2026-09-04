import Link from "next/link";
import { useTranslations } from "next-intl";

import { TeamLogo } from "@/components/TeamName";
import { cn } from "@/lib/utils";
import type { TeamNameInput } from "@/components/TeamName";

export type PodiumTeam = TeamNameInput & {
  id: number;
  /** One line under the name: the champion's roster, a finalist's result. */
  note?: string | null;
  href?: string;
};

export type PodiumProps = {
  first: PodiumTeam;
  second: PodiumTeam;
  /** Absent for a single-elimination bracket, which crowns no third place. */
  third?: PodiumTeam | null;
  className?: string;
};

/**
 * The finished tournament's answer to "who won", first on the overview. The
 * champion sits centre and taller; the medal tone comes from the shared
 * `--aqt-medal-*` tokens rather than any colour written here.
 */
export function Podium({ first, second, third, className }: Readonly<PodiumProps>) {
  const t = useTranslations();
  const tile = (team: PodiumTeam, place: 1 | 2 | 3) => {
    const tier = place === 1 ? "gold" : place === 2 ? "silver" : "bronze";
    const body = (
      <>
        <span
          className="font-mono text-[10px] uppercase tracking-[0.14em]"
          style={{ color: `var(--aqt-medal-${tier})` }}
        >
          {t(`tournamentDetail.podium.place${place}`)}
        </span>
        <TeamLogo team={team} size={place === 1 ? "lg" : "md"} className="mx-auto mt-2" />
        <span className={cn("mt-1.5 block truncate font-semibold", place === 1 ? "text-base" : "text-sm")} title={team.name}>
          {team.name}
        </span>
        {team.note ? (
          <span className="mt-0.5 block text-[11px] leading-snug text-[color:var(--aqt-fg-muted)]">
            {team.note}
          </span>
        ) : null}
      </>
    );
    const classes = cn(
      "block rounded-[10px] border bg-[color:var(--aqt-card)] px-3 py-3 text-center",
      place === 1
        ? "border-[color:var(--aqt-medal-gold)] pt-5"
        : "border-[color:var(--aqt-border)]"
    );
    return team.href ? (
      <Link href={team.href} className={cn(classes, "transition-colors hover:border-[color:var(--aqt-border-3)]")}>
        {body}
      </Link>
    ) : (
      <div className={classes}>{body}</div>
    );
  };

  return (
    <div
      className={cn("grid items-end gap-2", third ? "grid-cols-[1fr_1.2fr_1fr]" : "grid-cols-[1fr_1.2fr]", className)}
      role="list"
      aria-label={t("tournamentDetail.podium.label")}
    >
      <div role="listitem">{tile(second, 2)}</div>
      <div role="listitem">{tile(first, 1)}</div>
      {third ? <div role="listitem">{tile(third, 3)}</div> : null}
    </div>
  );
}
