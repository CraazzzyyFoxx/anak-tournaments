"use client"

import React, { useEffect, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import achievementsService from "@/services/achievements.service";
import { useQuery } from "@tanstack/react-query";

const AchievementPage = () => {
  const searchParams = useSearchParams();
  const [achievementId, setAchievementId] = useState<number>(1)

  useEffect(() => {
    const newSearchParams = new URLSearchParams(searchParams);
    setAchievementId(Number(newSearchParams.get("id")))
  }, [searchParams]);

  const { data } = useQuery({
    queryKey: ["achievement", achievementId],
    queryFn: () => achievementsService.getOne(achievementId),
  });

  return (
    <div>
      <div className="lg:ml-5 flex flex-row gap-4 items-center">
        <Image
          className="rounded-xl"
          src={`/achievements/${data?.slug}.webp`}
          width={90}
          height={90}
          alt={data?.slug || "image"}
        />
        <div className="flex flex-col">
          <h3 className="scroll-m-20 xs:text-lg xs1:text-2xl font-semibold tracking-tight">
            {data?.name}
          </h3>
          <div className="flex gap-2">
            <p className="text-muted-foreground text-sm">{data?.description_ru}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AchievementPage;