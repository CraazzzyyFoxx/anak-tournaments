"use client";

import { OverviewColumns } from "./OverviewCards";

/**
 * B: while it is being played (§3B). The matches lead, full width: they are
 * what a viewer opens the page for. Under them the stage being played beside
 * the reference column — the timeline as context, the format, the links.
 *
 * No broadcast card and no "played" tile any more: the hero carries both, as
 * its main action and under the stage it names.
 */
export function OverviewLiveView({
  nowBlock,
  miniBracket,
  groupTable,
  aboutCard,
  phasesCard,
  formatCard,
  linksCard
}: Readonly<{
  nowBlock: React.ReactNode;
  miniBracket: React.ReactNode;
  groupTable: React.ReactNode;
  aboutCard: React.ReactNode;
  phasesCard: React.ReactNode;
  formatCard: React.ReactNode;
  linksCard: React.ReactNode;
}>) {
  return (
    <div className="grid min-w-0 gap-10">
      {nowBlock}
      <OverviewColumns
        main={
          <>
            {miniBracket}
            {groupTable}
            {aboutCard}
          </>
        }
        aside={
          <>
            {phasesCard}
            {formatCard}
            {linksCard}
          </>
        }
      />
    </div>
  );
}
