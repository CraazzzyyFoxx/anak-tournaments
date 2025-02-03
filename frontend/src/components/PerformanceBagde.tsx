import React from "react";
import { MatchWithUserStats } from "@/types/user.types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import Image from "next/image";

export const PerformanceBadgeWithTooltip = ({ match }: { match: MatchWithUserStats }) => {
  const mapImagePath: string = match.map ? match.map?.image_path : "";
  let bgColor = "bg-placeBg";
  let color = "text-placeText";
  if (match.performance == 1) {
    bgColor = "bg-firstPlaceBg";
    color = "text-TopPlaceText";
  }
  if (match.performance == 2) {
    bgColor = "bg-secondPlaceBg";
    color = "text-TopPlaceText";
  }
  if (match.performance == 3) {
    bgColor = "bg-thirdPlaceBg";
  }

  return (
    <Tooltip>
      <TooltipTrigger>
        <div
          className={`inline-flex items-center rounded-xl border px-2.5 py-0.5 text-xs font-semibold ${bgColor} ${color}`}
        >
          <span>{match.performance}th</span>
        </div>
      </TooltipTrigger>
      <TooltipContent className="flex flex-col px-0 py-0 bg-background">
        <Image src={mapImagePath} alt="Map" height={100} width={200} />
        <div className="flex flex-col items-center gap-1 my-2">
          <h3 className="scroll-m-20 text-xl font-semibold tracking-tight text-white max-w-44 break-words text-center">
            {match.map?.name}
          </h3>
          <h3 className="scroll-m-20 text-xl font-semibold tracking-tight text-white">
            Score: {match.score.home} - {match.score.away}
          </h3>
        </div>
      </TooltipContent>
    </Tooltip>
  );
};

export const PerformanceBadge = ({ performance }: { performance: number | undefined }) => {
  let bgColor = "bg-[#2c3f52]";
  let color = "text-[#ffffff]";
  if (performance == 1) {
    bgColor = "bg-[#cbb765]";
    color = "text-[#121009]";
  }
  if (performance == 2) {
    bgColor = "bg-[#99b0cc]";
    color = "text-[#121009]";
  }
  if (performance == 3) {
    bgColor = "bg-[#a86243]";
  }

  return (
    <div
      className={`inline-flex items-center rounded-xl border px-2.5 py-0.5 text-xs font-semibold ${bgColor} ${color}`}
    >
      <span>{performance}th</span>
    </div>
  );
};
