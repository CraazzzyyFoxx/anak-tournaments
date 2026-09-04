"use client";

import { useTranslations } from "next-intl";

import { MapPool } from "../_components/MapPool";
import { PhaseTimeline } from "../_components/PhaseTimeline";
import { TournamentPageState } from "../_components/TournamentPageState";
import { TournamentShellSkeleton } from "../_components/TournamentSkeletons";
import TournamentLinkChips from "../_components/TournamentLinkChips";
import { useTournamentQuery } from "../_hooks/useTournamentClientData";
import { useTournamentMapPool } from "../_hooks/useTournamentMapPool";
import styles from "../TournamentDetail.module.css";

type TournamentOverviewPageProps = {
  tournamentId: number;
  slug: string;
};

/**
 * The tournament's landing section. Composition depends on the phase — see
 * docs/tournament-redesign/wireframes.html §3 — and is built out per variant
 * on top of this base: the phase timeline and the map pool are common to all.
 */
export default function TournamentOverviewPage({ tournamentId, slug }: Readonly<TournamentOverviewPageProps>) {
  const t = useTranslations();
  const tournamentQuery = useTournamentQuery(slug);
  const tournament = tournamentQuery.data;
  const mapPool = useTournamentMapPool(tournamentId);

  if (!tournament) {
    if (tournamentQuery.isError) {
      return <TournamentPageState state="initial-error" onRetry={() => void tournamentQuery.refetch()} />;
    }
    return <TournamentShellSkeleton />;
  }

  return (
    <section className={styles.publicDataPage} aria-label={t("common.overview")}>
      <div className="aqt-card-surface">
        <div className="aqt-card-body">
          <PhaseTimeline id="phases" tournament={tournament} orientation="horizontal" />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[6fr_4fr]">
        <div className="aqt-card-surface">
          <div className="aqt-card-head">
            <h2 className="aqt-card-title">{t("common.format")}</h2>
          </div>
          <div className="aqt-card-body">
            {tournament.description ? (
              <p className="text-sm leading-relaxed text-[color:var(--aqt-fg-muted)]">
                {tournament.description}
              </p>
            ) : null}
          </div>
        </div>
        <div className="space-y-4">
          {mapPool.pool.total > 0 ? (
            <div className="aqt-card-surface">
              <div className="aqt-card-body">
                <MapPool id="map-pool" pool={mapPool.pool} stages={mapPool.stages} variant="tiles" />
              </div>
            </div>
          ) : null}
          {tournament.links && tournament.links.length > 0 ? (
            <div className="aqt-card-surface">
              <div className="aqt-card-head">
                <h2 className="aqt-card-title">{t("tournamentDetail.overview.links")}</h2>
              </div>
              <div className="aqt-card-body">
                <TournamentLinkChips links={tournament.links} />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
