"use client";

import React from "react";
import { Tournament } from "@/types/tournament.types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";

export const TournamentStatus = ({ isFinished }: { isFinished: boolean }) => {
  return (
    <div className="flex items-center space-x-2">
      <span className="text-sm text-gray-600 dark:text-gray-400">Status:</span>
      <Badge
        className={
          isFinished
            ? "bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100"
            : "bg-yellow-100 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-100"
        }
      >
        {isFinished ? "Finished" : "Ongoing"}
      </Badge>
    </div>
  );
};

export const TournamentChallongeLink = ({ tournament }: { tournament: Tournament }) => {
  let slug = tournament.challonge_slug;
  const groups = tournament.groups.sort((a, b) => Number(a.is_groups) - Number(b.is_groups));

  if (!slug) {
    for (const group of groups) {
      if (group.challonge_slug) {
        slug = group.challonge_slug;
        break;
      }
    }
  }

  return (
    <div className="flex gap-2">
      <p>Bracket link:</p>
      <Link
        className="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
        href={`https://challonge.com/${slug}`}
      >
        {slug}
      </Link>
    </div>
  );
};

const TournamentCard = ({ tournament }: { tournament: Tournament }) => {
  const router = useRouter();

  const onClick = (event: React.MouseEvent) => {
    // Проверяем, был ли клик на ссылке
    const isLinkClicked = (event.target as HTMLElement).closest("a");
    if (isLinkClicked) {
      return; // Если клик был на ссылке, ничего не делаем
    }
    router.push(`/tournaments/${tournament.id}`);
  };

  return (
    <Card
      className="rounded-lg shadow-lg hover:shadow-xl transition-shadow duration-300"
      onClick={onClick}
    >
      <CardHeader>
        <CardTitle className="text-xl font-bold text-gray-900 dark:text-white">
          {tournament.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center space-x-2">
          <span className="text-sm text-gray-600 dark:text-gray-400">Participants:</span>
          <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-blue-100">
            {tournament.participants_count}
          </Badge>
        </div>
        <TournamentStatus isFinished={tournament.is_finished} />
        <div onClick={(e) => e.stopPropagation()}>
          <TournamentChallongeLink tournament={tournament} />
        </div>
      </CardContent>
    </Card>
  );
};

export default TournamentCard;
