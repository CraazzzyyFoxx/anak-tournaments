import React from "react";
import achievementsService from "@/services/achievements.service";
import AchievementCard from "@/app/achievements/components/AchievementCard";

const AchievementsPage = async () => {
  const achievements = await achievementsService.getAll(1, -1);

  return (
    <div className="grid 2xl:grid-cols-5 xl:grid-cols-4 lg:grid-cols-3 sm:grid-cols-2  gap-3 w-full">
      {achievements.results.map((achievement) => (
        <AchievementCard key={achievement.id} achievement={achievement} />
      ))}
    </div>
  );
};

export default AchievementsPage;
