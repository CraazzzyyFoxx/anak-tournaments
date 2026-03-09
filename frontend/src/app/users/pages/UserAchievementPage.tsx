import React from "react";
import { User } from "@/types/user.types";
import userService from "@/services/user.service";
import AchievementCard from "@/components/AchievementCard";
import UserAchievementsFilter from "@/app/users/components/UserAchievementsFilter";
import { Trophy } from "lucide-react";

interface UserAchievementPageProps {
  user: User;
  selectedTournamentId?: string;
}

const parseAchievementFilter = (selectedTournamentId?: string) => {
  if (!selectedTournamentId || selectedTournamentId === "all") {
    return { tournamentId: undefined, withoutTournament: undefined, selectValue: "all" };
  }

  if (selectedTournamentId === "none") {
    return { tournamentId: undefined, withoutTournament: true, selectValue: "none" };
  }

  if (selectedTournamentId.startsWith("t-")) {
    const parsedTournamentId = Number(selectedTournamentId.slice(2));
    if (Number.isFinite(parsedTournamentId) && parsedTournamentId > 0) {
      return {
        tournamentId: parsedTournamentId,
        withoutTournament: undefined,
        selectValue: `t-${parsedTournamentId}`
      };
    }
  }

  return { tournamentId: undefined, withoutTournament: undefined, selectValue: "all" };
};

const UserAchievementPage = async ({ user, selectedTournamentId }: UserAchievementPageProps) => {
  const { tournamentId, withoutTournament, selectValue } = parseAchievementFilter(selectedTournamentId);

  const [achievements, profile] = await Promise.all([
    userService.getUserAchievements(user.id, {
      tournamentId,
      withoutTournament
    }),
    userService.getUserProfile(user.id)
  ]);

  return (
    <div className="flex flex-col gap-4 w-full">
      <UserAchievementsFilter tournaments={profile.tournaments} selectedValue={selectValue} />
      {achievements.length > 0 ? (
          <div className="grid 2xl:grid-cols-5 xl:grid-cols-4 lg:grid-cols-3 sm:grid-cols-2 gap-2.5 w-full">
          {achievements.map((achievement) => (
            <AchievementCard
              key={achievement.id}
              achievement={achievement}
              href={`/achievements/${achievement.id}`}
              descriptionLocale="ru"
              showDetails
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-white/25">
          <Trophy className="h-8 w-8" />
          <p className="text-sm">No achievements found for this filter.</p>
        </div>
      )}
    </div>
  );
};

export default UserAchievementPage;
