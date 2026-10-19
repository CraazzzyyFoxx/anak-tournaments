"use client";

import { useTranslations } from "next-intl";

import { EYEBROW_CLASS } from "@/components/kit/tone";
import { roleOf } from "@/lib/roster/role-ref";
import type { Player, Team } from "@/types/team.types";

function InspectorField({
  label,
  children
}: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div className="min-w-0">
      <p className={EYEBROW_CLASS}>{label}</p>
      <p className="mt-0.5 truncate text-sm text-foreground">{children}</p>
    </div>
  );
}

function RosterList({ players }: Readonly<{ players: Player[] }>) {
  const t = useTranslations("adminPeople.teams");
  if (players.length === 0) {
    return <p className="mt-2 text-xs text-muted-foreground">{t("emptyRoster")}</p>;
  }

  return (
    <ul className="mt-2 space-y-1 text-sm">
      {players.map((player) => (
        <li key={player.id} className="flex items-center justify-between gap-2">
          <span className="truncate">{player.user?.name ?? player.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {roleOf(player.role)}
            {" · "}
            <span className="font-mono tabular-nums">{player.rank}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** What the inspector shows for a roster, before opening the editor page. */
export function TeamInspectorPanel({ team }: Readonly<{ team: Team }>) {
  const t = useTranslations("adminPeople.teams");
  const players = team.players ?? [];
  const starters = players.filter((player) => !player.is_substitution);
  const substitutes = players.filter((player) => player.is_substitution);
  // The captain is a roster row, so their name comes from the linked identity;
  // a captain inherited from before that rule can sit off the roster.
  const captain = players.find((player) => player.user_id === team.captain_id);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <InspectorField label={t("labels.captain")}>
          {captain?.user?.name ??
            captain?.name ??
            (team.captain_id > 0 ? `User #${team.captain_id}` : "—")}
        </InspectorField>
        <InspectorField label={t("labels.roster")}>
          {t("rosterCount", { starters: starters.length, substitutes: substitutes.length })}
        </InspectorField>
        <InspectorField label={t("labels.averageSr")}>
          <span className="font-mono tabular-nums">{team.avg_sr.toFixed(0)}</span>
        </InspectorField>
        <InspectorField label={t("labels.totalSr")}>
          <span className="font-mono tabular-nums">{team.total_sr}</span>
        </InspectorField>
        <InspectorField label={t("labels.group")}>{team.group?.name ?? "—"}</InspectorField>
        <InspectorField label={t("labels.placement")}>
          {team.placement != null ? (
            <span className="font-mono tabular-nums">#{team.placement}</span>
          ) : (
            "—"
          )}
        </InspectorField>
      </div>

      <section className="rounded-xl border border-border/60 p-3">
        <p className={EYEBROW_CLASS}>{t("startersTitle")}</p>
        <RosterList players={starters} />
      </section>

      <section className="rounded-xl border border-border/60 p-3">
        <p className={EYEBROW_CLASS}>{t("substitutes")}</p>
        <RosterList players={substitutes} />
      </section>
    </div>
  );
}
