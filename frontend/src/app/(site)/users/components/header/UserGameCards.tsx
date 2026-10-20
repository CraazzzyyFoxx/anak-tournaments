"use client";

import { useTranslations } from "next-intl";

import DivisionIcon from "@/components/DivisionIcon";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { GameMarkButton } from "@/components/workspace/GameMarkButton";
import { useDisciplineMetadata } from "@/hooks/useDisciplineMetadata";
import { useGameDescriptors } from "@/hooks/useGameDescriptors";
import { useGameScope } from "@/hooks/useGameScope";
import type { WorkspaceAxis } from "@/lib/site/discipline-scope";
import type { DisciplineDescriptor } from "@/types/discipline.types";
import type { UserGameSummary } from "@/types/user.types";

function GameCard({
  game,
  descriptor,
  axis,
  onSelect
}: Readonly<{
  game: UserGameSummary;
  descriptor: DisciplineDescriptor;
  axis: WorkspaceAxis;
  onSelect: (code: string) => void;
}>) {
  const t = useTranslations();
  // Each game draws its roles from its own dictionary on the viewed axis.
  const ontology = useDisciplineMetadata(axis, game.discipline).data ?? null;
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-[color:var(--aqt-border)] bg-[color:var(--aqt-card)] p-3">
      <div className="flex items-center gap-2">
        <GameMarkButton discipline={descriptor} onSelect={onSelect} size={22} />
        <h3 className="m-0 truncate text-body font-semibold text-[color:var(--aqt-fg)]">{descriptor.name}</h3>
      </div>
      {game.roles.length > 0 ? (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {game.roles.map((role, index) => (
            <li key={`${role.role?.role ?? "open"}-${index}`} className="inline-flex items-center gap-1">
              <PlayerRoleIcon role={role.role} ontology={ontology} size={18} />
              <DivisionIcon
                division={role.division}
                tournamentGrid={role.division_grid_version}
                discipline={game.discipline}
                width={22}
                height={22}
              />
            </li>
          ))}
        </ul>
      ) : null}
      <dl className="m-0 grid grid-cols-2 gap-2 text-caption">
        <div>
          <dt className="text-label font-bold uppercase tracking-label text-[color:var(--aqt-fg-faint)]">
            {t("users.profile.stats.tournaments")}
          </dt>
          <dd className="m-0 font-semibold tabular-nums">{game.tournaments_count}</dd>
        </div>
        <div>
          <dt className="sr-only">{t("users.profile.stats.won", { count: String(game.tournaments_won) })}</dt>
          <dd aria-hidden className="m-0 tabular-nums text-[color:var(--aqt-fg-muted)]">
            {t("users.profile.stats.won", { count: String(game.tournaments_won) })}
          </dd>
        </div>
      </dl>
    </li>
  );
}

/**
 * One card per game the player played (spec §6.6), most tournaments first: roles and divisions on that game's grid,
 * tournaments and wins. A card's mark narrows the scope to that game, as a row's mark does on `/users`.
 */
export default function UserGameCards({ games, axis }: Readonly<{ games: UserGameSummary[]; axis: WorkspaceAxis }>) {
  const t = useTranslations("common.discipline");
  const descriptors = useGameDescriptors();
  const scope = useGameScope({ pageClass: "multi" });
  if (games.length === 0) return null;
  return (
    <ul aria-label={t("all")} className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
      {games.map((game) => {
        const descriptor = descriptors.get(game.discipline);
        return descriptor ? (
          <GameCard
            key={game.discipline}
            game={game}
            descriptor={descriptor}
            axis={axis}
            onSelect={(code) => scope.selectScope(code)}
          />
        ) : null;
      })}
    </ul>
  );
}
