"use client";

import React from "react";

import { Achievement } from "@/types/achievement.types";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import Image from "next/image";
import { useRouter } from "next/navigation";

const AchievementCard = ({ achievement }: { achievement: Achievement }) => {
  const router = useRouter();

  return (
    <Card
      className="relative bg-cover bg-center rounded-lg shadow-md overflow-hidden transition-transform transform hover:scale-110 min-h-[240px] group aspect-square"
      onClick={() => router.push(`/achievements/${achievement.id}`)}
    >
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
      <div className="absolute bottom-2 left-2 bg-black bg-opacity-0 text-white transition-opacity duration-300 opacity-0 group-hover:opacity-100 z-10" />
      <CardHeader className="relative p-4 z-10">
        <CardTitle className="text-xl font-bold text-white drop-shadow-2xl">
          {achievement.name}
        </CardTitle>
      </CardHeader>
    </Card>
  );
};

export default AchievementCard;
