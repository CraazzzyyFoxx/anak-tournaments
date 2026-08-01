import React from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { PlaceBadge } from "@/components/ui/place-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MatchWithUserStats } from "@/types/user.types";

/**
 * Placement medal for a player's performance rank within a single match.
 *
 * Pass `tooltip` (the match itself) to get the richer variant that reveals the
 * map and the final score on hover; without it the badge is plain. The medal
 * colours come from `PlaceBadge` / the `--aqt-medal-*` tokens rather than the
 * hand-written gold/silver/bronze chain this component used to carry twice.
 */
export const PerformanceBadge = ({
  performance,
  tooltip
}: {
  performance: number | null | undefined;
  tooltip?: MatchWithUserStats;
}) => {
  const t = useTranslations();

  if (performance == null || !Number.isFinite(performance)) {
    return <span className="text-xs tabular-nums text-[color:var(--aqt-fg-faint)]">—</span>;
  }

  const badge = <PlaceBadge place={performance} />;

  if (!tooltip) {
    return badge;
  }

  const mapName = tooltip.map?.name;
  const mapImagePath = tooltip.map?.image_path;

  return (
    <Tooltip>
      <TooltipTrigger className="cursor-pointer">{badge}</TooltipTrigger>
      <TooltipContent className="flex flex-col bg-background px-0 py-0">
        {mapImagePath && (
          <Image
            src={mapImagePath}
            alt={mapName ?? ""}
            aria-hidden={mapName ? undefined : true}
            height={100}
            width={200}
          />
        )}
        <div className="my-2 flex flex-col items-center gap-1">
          {mapName && (
            <p className="max-w-44 break-words text-center text-xl font-semibold tracking-tight text-[color:var(--aqt-fg)]">
              {mapName}
            </p>
          )}
          <p className="text-xl font-semibold tracking-tight tabular-nums text-[color:var(--aqt-fg)]">
            {t("matches.col.score")}: {tooltip.score.home} - {tooltip.score.away}
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
};
