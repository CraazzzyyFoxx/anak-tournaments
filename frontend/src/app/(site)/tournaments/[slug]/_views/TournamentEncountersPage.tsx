"use client";

import { useTranslations } from "next-intl";

import EncountersTable, {
  getEncountersQueryPresentation,
  useEncountersTableController
} from "@/components/EncountersTable";

import styles from "../TournamentDetail.module.css";
import { TournamentPageState } from "../_components/TournamentPageState";
import { TournamentMatchesSkeleton } from "../_components/TournamentSkeletons";
import { UpdatingBadge } from "../_components/UpdatingBadge";
import { useTournamentQuery } from "../_hooks/useTournamentClientData";

interface TournamentEncounterPageProps {
  tournamentId: number;
  slug: string;
  page: number;
  search: string;
}

const TournamentEncountersPage = ({ tournamentId, slug, page, search }: TournamentEncounterPageProps) => {
  const t = useTranslations();
  // Keyed by `slug`, not `tournamentId`: TournamentClientLayout's overview
  // query uses the same ref, so this reads its cache entry instead of
  // triggering a second fetch under a different key.
  const tournamentQuery = useTournamentQuery(slug);
  const tournament = tournamentQuery.data;
  const workspaceId = tournament ? tournament.workspace_id : undefined;
  const controller = useEncountersTableController({
    initialPage: page,
    search,
    tournamentId,
    workspaceId,
    enabled: tournament !== undefined
  });
  const rows = controller.encountersQuery.data ? controller.encountersQuery.data.results : [];
  const presentation = getEncountersQueryPresentation({
    data: controller.encountersQuery.data,
    itemCount: rows.length,
    isPending: controller.encountersQuery.isPending,
    isError: controller.encountersQuery.isError,
    isFetching: controller.encountersQuery.isFetching
  });

  if (!tournament) {
    if (tournamentQuery.isError) {
      return (
        <TournamentPageState state="initial-error" onRetry={() => void tournamentQuery.refetch()} />
      );
    }
    return <TournamentMatchesSkeleton />;
  }

  if (presentation.initialState === "error") {
    return (
      <TournamentPageState
        state="initial-error"
        onRetry={() => void controller.encountersQuery.refetch()}
      />
    );
  }

  const encounters = controller.encountersQuery.data;
  if (
    presentation.initialState === "skeleton" ||
    presentation.contentState === null ||
    !encounters
  ) {
    return <TournamentMatchesSkeleton />;
  }

  // A zero-row page has two very different causes and the old code conflated
  // them: it always rendered the full table (headers, search box, pagination)
  // and stacked a "nothing published yet" card underneath, so the user read two
  // contradictory statements at once. With no search term there is genuinely
  // nothing to show, so the card replaces the table. With a search term the
  // table must stay mounted — it owns the search field, which is the only way
  // back — and its empty body is the answer on its own.
  const isTrueEmpty = presentation.contentState === "empty" && search.length === 0;

  const content = (
    <section className={styles.publicDataPage} aria-label={t("common.matches")}>
      {presentation.showUpdating ? <UpdatingBadge /> : null}

      {isTrueEmpty ? (
        <TournamentPageState
          state="empty"
          title={t("tournamentDetail.publicPages.matches.emptyTitle")}
          description={t("tournamentDetail.publicPages.matches.emptyDescription")}
        />
      ) : (
        <EncountersTable
          encounters={encounters}
          currentPage={controller.currentPage}
          onSetPage={controller.setCurrentPage}
          search={search}
          searchInputRef={controller.searchInputRef}
          onSearchInput={controller.onSearchInput}
          hideTournament
        />
      )}
    </section>
  );

  if (presentation.showRefreshError) {
    return (
      <TournamentPageState
        state="refresh-error"
        onRetry={() => void controller.encountersQuery.refetch()}
        isUpdating={controller.encountersQuery.isFetching}
      >
        {content}
      </TournamentPageState>
    );
  }

  return content;
};

export default TournamentEncountersPage;
