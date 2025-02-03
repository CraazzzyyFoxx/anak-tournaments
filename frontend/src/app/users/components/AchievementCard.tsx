import React from "react";

import { AchievementRarity } from "@/types/achievement.types";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
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
import { TypographyH2 } from "@/components/ui/typography";
import Link from "next/link";

const AchievementCard = ({ achievement }: { achievement: AchievementRarity }) => {
  return (
    <Card className="relative bg-cover bg-center rounded-lg shadow-md overflow-hidden transition-transform transform hover:scale-110 min-h-[240px] group aspect-square">
      <Image
        src={`/achievements/${achievement.slug}.webp`}
        alt={achievement.slug}
        fill={true}
        quality={100}
      />
      <div className="absolute inset-0 bg-black bg-opacity-20 transition duration-300 group-hover:bg-opacity-60" />
      <div className="absolute top-2 right-2 bg-black bg-opacity-50 text-white text-xs rounded px-2 py-1 z-10">
        {(achievement.rarity * 100).toFixed(2)}%
      </div>
      <div className="absolute bottom-2 right-2 bg-black bg-opacity-50 text-white text-xs rounded px-2 py-1 z-10">
        x{achievement.count}
      </div>
      <div className="absolute inset-0 flex items-center justify-center text-white p-4 transition-opacity duration-300 opacity-0 group-hover:opacity-100 z-10">
        <p className="text-center text-sm">{achievement.description_ru}</p>
      </div>
      <div className="absolute bottom-2 left-2 bg-black bg-opacity-0 text-white transition-opacity duration-300 opacity-0 group-hover:opacity-100 z-10">
        {achievement.tournaments_ids.length > 0 && (
          <Dialog>
            <DialogTrigger asChild>
              <Ellipsis className="rotate-90" />
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>
                  <TypographyH2>{achievement.name}</TypographyH2>
                </DialogTitle>
                <DialogDescription className="pb-4">
                  <p className="">{achievement.description_ru}</p>
                </DialogDescription>
              </DialogHeader>
              <div>
                <div>Получено на следующих турнирах:</div>
                <ul className="ml-6 list-disc [&>li]:mt-2">
                  {achievement.tournaments.map((tournament) => (
                    <li key={`${achievement.slug}-${tournament.id}`}>
                      <Link href={`/tournaments/${tournament.id}`}>{tournament.name}</Link>
                    </li>
                  ))}
                </ul>
              </div>
              {achievement.matches.length > 0 ? (
                <div>
                  <div>Матчи:</div>
                  <ul className="ml-6 list-disc [&>li]:mt-2">
                    {achievement.matches.map((match) => (
                      <li key={`${achievement.slug}-${match.id}`}>
                        <Link href={`/matches/${match.id}`}>
                          {`${match.home_team?.name} - ${match.away_team?.name}`}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <></>
              )}
            </DialogContent>
          </Dialog>
        )}
      </div>
      <CardHeader className="relative p-4 z-10">
        <CardTitle className="text-xl font-bold text-white drop-shadow-2xl">
          <Link href={`/achievements/${achievement.id}`}>{achievement.name}</Link>
        </CardTitle>
      </CardHeader>
    </Card>
  );
};

export default AchievementCard;
