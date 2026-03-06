import React from "react";

import { AchievementRarity } from "@/types/achievement.types";
import Image from "next/image";
import { Ellipsis } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import Link from "next/link";

const AchievementCard = ({ achievement }: { achievement: AchievementRarity }) => {
  const hasDetails = achievement.tournaments_ids.length > 0 || achievement.matches.length > 0;

  return (
    <div className="relative overflow-hidden rounded-xl border border-white/[0.07] aspect-square group transition-colors duration-200 hover:border-white/[0.15]">
      {/* Background image */}
      <Image
        src={`/achievements/${achievement.slug}.webp`}
        alt={achievement.slug}
        fill={true}
        quality={100}
        sizes="(min-width: 1536px) 20vw, (min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
      />

      {/* Gradient for name (top) and badges (bottom) readability */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/65 via-transparent to-black/60" />

      {/* Hover description overlay */}
      <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center p-5 opacity-0 bg-black/65 transition-opacity duration-200 group-hover:opacity-100">
        <p className="line-clamp-5 text-center text-sm leading-snug text-white/90">
          {achievement.description_en}
        </p>
      </div>

      {/* Rarity % — top right */}
      <div className="absolute top-2 right-2 z-[10] rounded-full bg-black/55 border border-white/[0.12] px-2 py-0.5 text-[10px] tabular-nums text-white/80 backdrop-blur-sm">
        {(achievement.rarity * 100).toFixed(2)}%
      </div>

      {/* Achievement name — top left */}
      <div className="absolute top-0 left-0 right-0 px-3 pt-3 z-[10]">
        <Link
          href={`/achievements/${achievement.id}`}
          className="text-sm font-semibold text-white leading-snug line-clamp-2 drop-shadow-md hover:text-white/80 transition-colors"
        >
          {achievement.name}
        </Link>
      </div>

      {/* Count badge — bottom right */}
      <div className="absolute bottom-2 right-2 z-[10] rounded-full bg-black/55 border border-white/[0.12] px-2 py-0.5 text-[10px] tabular-nums text-white/80 backdrop-blur-sm">
        ×{achievement.count}
      </div>

      {/* Details dialog — bottom left, only shown when there are linked tournaments or matches */}
      {hasDetails && (
        <Dialog>
          <DialogTrigger asChild>
            <button
              type="button"
              aria-label={`Open details for ${achievement.name}`}
              className="absolute bottom-2 left-2 z-[10] inline-flex items-center justify-center rounded-full bg-black/55 border border-white/[0.12] p-1.5 text-white/60 backdrop-blur-sm transition-colors hover:bg-black/75 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 cursor-pointer"
            >
              <Ellipsis className="h-3.5 w-3.5 rotate-90" aria-hidden />
            </button>
          </DialogTrigger>
          <DialogContent className="border-white/[0.07] sm:max-w-md gap-0 p-5">
            <DialogHeader className="mb-4">
              <DialogTitle className="text-base font-semibold text-white leading-snug mb-1.5">
                {achievement.name}
              </DialogTitle>
              <DialogDescription className="text-sm text-white/55 leading-relaxed">
                {achievement.description_ru}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4">
              {achievement.tournaments_ids.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="text-[10px] uppercase tracking-wide text-white/35 font-semibold">
                    Received at
                  </div>
                  <ul className="flex flex-col gap-1.5">
                    {achievement.tournaments.map((tournament) => (
                      <li key={`${achievement.slug}-${tournament.id}`}>
                        <Link
                          href={`/tournaments/${tournament.id}`}
                          className="text-sm text-white/65 hover:text-white transition-colors"
                        >
                          {tournament.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {achievement.matches.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="text-[10px] uppercase tracking-wide text-white/35 font-semibold">
                    Matches
                  </div>
                  <ul className="flex flex-col gap-1.5">
                    {achievement.matches.map((match) => (
                      <li key={`${achievement.slug}-${match.id}`}>
                        <Link
                          href={`/matches/${match.id}`}
                          className="text-sm text-white/65 hover:text-white transition-colors"
                        >
                          {`${match.home_team?.name} – ${match.away_team?.name}`}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

export default AchievementCard;
