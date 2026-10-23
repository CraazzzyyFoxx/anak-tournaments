import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import styles from "@/components/draft/DraftRoom.module.css";
import { Skeleton } from "@/components/ui/skeleton";

function LoadingRegion({ className, children }: Readonly<{ className: string; children: ReactNode }>) {
  const t = useTranslations("draftRedesign");

  return (
    <div
      className={className}
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-skeleton-variant="draft"
    >
      <span className="sr-only">{t("loadingTitle")}</span>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

const TICKS = 12;
const POOL_ROWS = 7;
const TEAM_ROWS = 6;
/** The loaded roster row carries five seats; the pool head carries five role meters. */
const TEAM_CELLS = 5;
const METERS = 5;

/** Mirrors the loaded room: header row + clock strip, then the pool and teams panels. */
function RoomSkeleton() {
  return (
    <>
      <div className={styles.skeletonHeader} data-draft-skeleton="header">
        <div className={styles.skeletonHeaderRow}>
          <div className={styles.skeletonBackAction} data-draft-skeleton="back-action">
            <Skeleton className={styles.skeletonBackArrow} />
            <Skeleton className={styles.skeletonBackLabel} />
          </div>
          <span className={styles.skeletonDivider} />
          <Skeleton className={styles.skeletonTitle} />
          <Skeleton className={styles.skeletonStatusPill} data-draft-skeleton="status-pill" />
          <div className={styles.skeletonHeaderMeta}>
            <Skeleton className={styles.skeletonFormat} />
            <Skeleton className={styles.skeletonViewers} />
            <Skeleton className={styles.skeletonSeat} />
          </div>
        </div>
        <div className={styles.skeletonStripBand}>
          <div className={styles.skeletonStrip} data-draft-skeleton="clock-strip">
            <Skeleton className={styles.skeletonTimer} data-draft-skeleton="timer" />
            <div className={styles.skeletonWho}>
              <Skeleton className={styles.skeletonEyebrow} />
              <Skeleton className={styles.skeletonWhoName} />
            </div>
            <div className={styles.skeletonProgress}>
              <Skeleton className={styles.skeletonProgressLine} />
              <div className={styles.skeletonTrack} data-draft-skeleton="tick-track">
                {Array.from({ length: TICKS }, (_, index) => (
                  <Skeleton className={styles.skeletonTick} key={index} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.skeletonBody}>
        <div className={styles.skeletonTabBar} data-draft-skeleton="tab-bar">
          <Skeleton className={styles.skeletonTabBarItem} />
          <Skeleton className={styles.skeletonTabBarItem} />
        </div>
        <div className={styles.skeletonPanels}>
          <section
            className={`${styles.skeletonPanel} ${styles.roomPanel}`}
            data-draft-skeleton="pool"
          >
            <div className={styles.skeletonPanelHead}>
              <div className={styles.skeletonHeadRow}>
                <Skeleton className={styles.skeletonPanelTitle} />
                <Skeleton className={styles.skeletonSearch} />
              </div>
              <div className={styles.skeletonTabStrip}>
                <Skeleton className={styles.skeletonTab} />
                <Skeleton className={styles.skeletonTab} />
                <Skeleton className={styles.skeletonTab} />
              </div>
              <div className={styles.skeletonChips}>
                <Skeleton className={styles.skeletonChip} />
                <Skeleton className={styles.skeletonChip} />
                <Skeleton className={styles.skeletonChip} />
              </div>
              <div className={styles.skeletonMeters}>
                {Array.from({ length: METERS }, (_, index) => (
                  <Skeleton className={styles.skeletonMeter} key={index} />
                ))}
              </div>
            </div>
            <div className={styles.skeletonRows}>
              {Array.from({ length: POOL_ROWS }, (_, index) => (
                <div className={styles.skeletonRow} data-draft-skeleton="pool-row" key={index}>
                  <Skeleton className={styles.skeletonRowName} />
                  <Skeleton className={styles.skeletonRowCell} />
                  <Skeleton className={styles.skeletonRowCell} />
                  <Skeleton className={styles.skeletonRowCell} />
                </div>
              ))}
            </div>
          </section>
          <section
            className={`${styles.skeletonPanel} ${styles.roomPanel}`}
            data-draft-skeleton="teams"
          >
            <div className={styles.skeletonPanelHead}>
              <div className={styles.skeletonTabStrip}>
                <Skeleton className={styles.skeletonTab} />
                <Skeleton className={styles.skeletonTab} />
              </div>
              <div className={styles.skeletonColHead}>
                {Array.from({ length: TEAM_CELLS }, (_, index) => (
                  <Skeleton className={styles.skeletonColLabel} key={index} />
                ))}
              </div>
            </div>
            <div className={styles.skeletonRows}>
              {Array.from({ length: TEAM_ROWS }, (_, index) => (
                <div className={styles.skeletonRow} data-draft-skeleton="team-row" key={index}>
                  <Skeleton className={styles.skeletonRowName} />
                  {Array.from({ length: TEAM_CELLS }, (_, cell) => (
                    <Skeleton className={styles.skeletonRowCell} key={cell} />
                  ))}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

/** Route-level loading: the page frame is not mounted yet, so this brings the room surface. */
export function DraftRoomSkeleton() {
  return (
    <LoadingRegion className={`${styles.room} ${styles.skeletonRoom} site-theme`}>
      <RoomSkeleton />
    </LoadingRegion>
  );
}

/** Inside the loaded page while the board's first fetch runs. */
export function DraftBoardSkeleton() {
  return (
    <LoadingRegion className={styles.skeletonBoardRegion}>
      <RoomSkeleton />
    </LoadingRegion>
  );
}
