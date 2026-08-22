import type { StageSummary, TournamentStatus } from "@/types/tournament.types";

export type TournamentSectionId =
  | "bracket" | "stream" | "teams" | "participants" | "schedule" | "matches" | "maps" | "heroes" | "standings" | "draft";

type TournamentNavReasonKey =
  | "tournamentDetail.nav.reasons.competitionNotStarted"
  | "tournamentDetail.nav.reasons.noStages"
  | "tournamentDetail.nav.reasons.noSchedule"
  | "tournamentDetail.nav.reasons.noTeams";

/** Every section labels itself from `common.<id>`. */
export type TournamentSectionLabelKey = `common.${TournamentSectionId}`;

export type TournamentSectionNavItem = {
  id: TournamentSectionId;
  labelKey: TournamentSectionLabelKey;
  href: string;
  active: boolean;
  available: boolean;
  reasonKey: TournamentNavReasonKey | null;
};

type BuildTournamentSectionNavInput = {
  tournamentId: string;
  status: TournamentStatus;
  stages: StageSummary[];
  teamFormation?: string;
  /**
   * Whether the organizer published any `tournament_phase_schedule` row. The
   * Schedule section has nothing to show without one, so it locks rather than
   * leading to an empty page.
   */
  hasSchedule?: boolean;
  /**
   * Whether any team exists yet. Teams are formed before play starts (balancer
   * run or draft), so the section opens as soon as there is a roster to show
   * rather than waiting for the competition phase.
   */
  hasTeams?: boolean;
  /**
   * Whether the tournament has any stream at all — an official broadcast link
   * or a participant currently live. Unlike Schedule and Teams, the Stream
   * section does not lock when it is empty: it disappears. A lock advertises
   * content the organizer has not published YET, and every tournament would
   * carry that promise forever, because most of them never have a stream.
   */
  hasStreams?: boolean;
  pathname: string;
};

const competitionStatuses = new Set<TournamentStatus>([
  "live",
  "playoffs",
  "completed",
  "archived"
]);

const competitionOnlySections = new Set<TournamentSectionId>([
  "bracket",
  "matches",
  "heroes",
  "standings"
]);

const tournamentSections: Exclude<TournamentSectionId, "draft">[] = [
  "bracket",
  "stream",
  "teams",
  "participants",
  // Sits with `participants`, not next to `teams`: both read registration-phase
  // data, and the post-balancer `teams` tab carries the same visible label, so
  // neighbouring them would read as a duplicate rather than two views.
  "schedule",
  "matches",
  "maps",
  "heroes",
  "standings"
];

function normalizePathname(pathname: string): string {
  const path = pathname.split(/[?#]/, 1)[0] || "/";
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function resolveBracketHref(tournamentId: string, stages: StageSummary[]): string {
  const active = stages.find((stage) => stage.is_active);
  const elimination = stages.find(
    (stage) =>
      stage.stage_type === "single_elimination" || stage.stage_type === "double_elimination"
  );
  const group = stages.find(
    (stage) => stage.stage_type === "round_robin" || stage.stage_type === "swiss"
  );
  const primary = active ?? elimination ?? group ?? stages[0];

  return primary
    ? `/tournaments/${tournamentId}/bracket?stage=${primary.id}`
    : `/tournaments/${tournamentId}/bracket`;
}

/**
 * Why a section is locked, or `null` when nothing locks it. Order is the
 * precedence the rail explains: the phase gate is the broadest reason, so it
 * speaks first, and the per-section gates only get a say once the phase allows
 * the section at all. `available` is the absence of any reason, so the tooltip
 * and the lock can never disagree.
 */
function resolveNavLockReason(
  locks: Readonly<{
    phaseLocked: boolean;
    stageLocked: boolean;
    scheduleLocked: boolean;
    teamsLocked: boolean;
  }>
): TournamentNavReasonKey | null {
  if (locks.phaseLocked) return "tournamentDetail.nav.reasons.competitionNotStarted";
  if (locks.stageLocked) return "tournamentDetail.nav.reasons.noStages";
  if (locks.scheduleLocked) return "tournamentDetail.nav.reasons.noSchedule";
  if (locks.teamsLocked) return "tournamentDetail.nav.reasons.noTeams";
  return null;
}

export function buildTournamentSectionNav({
  tournamentId,
  status,
  stages,
  teamFormation,
  hasSchedule = false,
  hasTeams = false,
  hasStreams = false,
  pathname
}: BuildTournamentSectionNavInput): TournamentSectionNavItem[] {
  const competitionStarted = competitionStatuses.has(status);
  const currentPath = normalizePathname(pathname);
  // Two sections are present-or-absent rather than open-or-locked, because a
  // locked tab claims the content exists somewhere: `draft`, which only a draft
  // tournament has at all, and `stream`, which needs a broadcast link or a live
  // participant. `stream` is filtered from its display position instead of
  // appended like `draft`, so the rail keeps one order in every case.
  const sections: TournamentSectionId[] = [
    ...tournamentSections.filter((id) => {
      if (id === "stream") return hasStreams;
      return true;
    }),
    ...(teamFormation === "draft" ? (["draft"] as const) : [])
  ];

  return sections.map((id) => {
    const href =
      id === "draft"
        ? `/draft/${tournamentId}`
        : id === "bracket"
          ? resolveBracketHref(tournamentId, stages)
          : `/tournaments/${tournamentId}/${id}`;
    const canonicalPath = href.split("?", 1)[0];
    const phaseLocked = competitionOnlySections.has(id) && !competitionStarted;
    const stageLocked = id === "bracket" && competitionStarted && stages.length === 0;
    const scheduleLocked = id === "schedule" && !hasSchedule;
    const teamsLocked = id === "teams" && !hasTeams && !competitionStarted;
    const reasonKey = resolveNavLockReason({
      phaseLocked,
      stageLocked,
      scheduleLocked,
      teamsLocked
    });

    return {
      id,
      labelKey: `common.${id}`,
      href,
      active: currentPath === canonicalPath,
      available: reasonKey === null,
      reasonKey
    };
  });
}

export type TournamentRailElement = {
  readonly scrollWidth: number;
  readonly clientWidth: number;
  scrollLeft: number;
  addEventListener(type: "scroll", listener: () => void, options?: AddEventListenerOptions): void;
  removeEventListener(type: "scroll", listener: () => void): void;
  scrollBy(options: ScrollToOptions): void;
};

export type TournamentRailScrollState = {
  hasOverflow: boolean;
  canScrollPrevious: boolean;
  canScrollNext: boolean;
};

type TournamentRailMeasurementContainer = {
  readonly clientWidth: number;
};

type RailResizeObserver = {
  observe(target: TournamentRailElement | TournamentRailMeasurementContainer): void;
  disconnect(): void;
};

type RailResizeObserverFactory = (callback: () => void) => RailResizeObserver;

type WindowResizeTarget = {
  addEventListener(type: "resize", listener: () => void): void;
  removeEventListener(type: "resize", listener: () => void): void;
};

type ObserveTournamentRailOptions = {
  createResizeObserver?: RailResizeObserverFactory | null;
  measurementContainer?: TournamentRailMeasurementContainer;
  windowTarget?: WindowResizeTarget;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (id: number) => void;
};

const SCROLL_EDGE_TOLERANCE = 2;

export function getTournamentRailScrollState(
  rail: Pick<TournamentRailElement, "scrollWidth" | "clientWidth" | "scrollLeft">,
  availableWidth = rail.clientWidth
): TournamentRailScrollState {
  const maxScrollLeft = Math.max(0, rail.scrollWidth - rail.clientWidth);
  const hasOverflow = rail.scrollWidth - availableWidth > SCROLL_EDGE_TOLERANCE;

  return {
    hasOverflow,
    canScrollPrevious: hasOverflow && rail.scrollLeft > SCROLL_EDGE_TOLERANCE,
    canScrollNext: hasOverflow && maxScrollLeft - rail.scrollLeft > SCROLL_EDGE_TOLERANCE
  };
}

export function scrollTournamentRail(
  rail: TournamentRailElement,
  direction: -1 | 1,
  behavior: ScrollBehavior
) {
  rail.scrollBy({
    left: direction * Math.max(180, rail.clientWidth * 0.65),
    behavior
  });
}

/**
 * The platform `ResizeObserver`, adapted to `RailResizeObserver`; `null` where
 * the API is absent (SSR, older jsdom) and the rail has to fall back to window
 * resize events alone. Kept out of `observeTournamentRail` so that its option
 * plumbing stays a single flat choice: `undefined` means "use this default",
 * `null` means "observing is deliberately off".
 */
function defaultRailResizeObserverFactory(): RailResizeObserverFactory | null {
  if (typeof ResizeObserver === "undefined") return null;

  return (callback: () => void): RailResizeObserver => {
    const observer = new ResizeObserver(callback);
    return {
      observe(target) {
        observer.observe(target as Element);
      },
      disconnect() {
        observer.disconnect();
      }
    };
  };
}

export function observeTournamentRail(
  rail: TournamentRailElement,
  onChange: (state: TournamentRailScrollState) => void,
  options: ObserveTournamentRailOptions = {}
) {
  const requestFrame = options.requestAnimationFrame ?? window.requestAnimationFrame.bind(window);
  const cancelFrame = options.cancelAnimationFrame ?? window.cancelAnimationFrame.bind(window);
  const windowTarget = options.windowTarget ?? (typeof window === "undefined" ? null : window);
  const createResizeObserver =
    options.createResizeObserver === undefined
      ? defaultRailResizeObserverFactory()
      : options.createResizeObserver;
  let frameId: number | null = null;
  let disposed = false;

  const refresh = () => {
    if (disposed) return;
    if (frameId !== null) return;
    frameId = requestFrame(() => {
      frameId = null;
      if (!disposed) {
        onChange(
          getTournamentRailScrollState(
            rail,
            options.measurementContainer?.clientWidth ?? rail.clientWidth
          )
        );
      }
    });
  };

  rail.addEventListener("scroll", refresh, { passive: true });
  const resizeObserver = createResizeObserver?.(refresh) ?? null;
  if (resizeObserver) {
    resizeObserver.observe(rail);
    if (options.measurementContainer) {
      resizeObserver.observe(options.measurementContainer);
    }
  } else windowTarget?.addEventListener("resize", refresh);
  refresh();

  return {
    refresh,
    cleanup() {
      if (disposed) return;
      disposed = true;
      rail.removeEventListener("scroll", refresh);
      if (resizeObserver) resizeObserver.disconnect();
      else windowTarget?.removeEventListener("resize", refresh);
      if (frameId !== null) {
        cancelFrame(frameId);
        frameId = null;
      }
    }
  };
}
