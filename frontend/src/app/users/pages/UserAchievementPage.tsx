import React from "react";
import { User } from "@/types/user.types";
import userService from "@/services/user.service";
import AchievementCard from "@/app/users/components/AchievementCard";

const UserAchievementPage = async ({ user }: { user: User }) => {
  const achievements = await userService.getUserAchievements(user.id);

  return (
    <div className="grid 2xl:grid-cols-5 xl:grid-cols-4 lg:grid-cols-3 sm:grid-cols-2  gap-3 w-full">
      {achievements.map((achievement) => (
        <AchievementCard key={achievement.id} achievement={achievement} />
      ))}
    </div>
  );
};

export default UserAchievementPage;
