import { User, UserTournamentSummary } from "@/types/user.types";
import type { StatsScope } from "@/lib/site/stats-scope";
import userService from "@/services/user.service";
import { AchievementRarity } from "@/types/achievement.types";
import AchievementsView from "@/app/(site)/users/components/achievements/AchievementsView";

interface UserAchievementPageProps {
  user: User;
  /** The profile's tournaments (of the browsed game, or of every game): the tournament filter's options. */
  tournaments: UserTournamentSummary[];
  selectedTournamentId?: string;
  scope: StatsScope;
  /** One game's rules only (earned and locked); omitted = every game's, marked. */
  discipline?: string;
  showGames?: boolean;
}

const parseAchievementFilter = (selectedTournamentId?: string) => {
  if (selectedTournamentId === "none") {
    return { tournamentId: undefined, withoutTournament: true };
  }

  if (selectedTournamentId?.startsWith("t-")) {
    const parsedTournamentId = Number(selectedTournamentId.slice(2));
    if (Number.isFinite(parsedTournamentId) && parsedTournamentId > 0) {
      return { tournamentId: parsedTournamentId, withoutTournament: undefined };
    }
  }

  return { tournamentId: undefined, withoutTournament: undefined };
};

const UserAchievementPage = async ({
  user,
  tournaments,
  selectedTournamentId,
  scope,
  discipline,
  showGames = false
}: UserAchievementPageProps) => {
  const { tournamentId, withoutTournament } = parseAchievementFilter(selectedTournamentId);
  const achievements = await userService
    .getUserAchievements(user.id, {
      tournamentId,
      withoutTournament,
      // Locked achievements only make sense for the global (all-tournaments) view.
      includeLocked: tournamentId === undefined && !withoutTournament,
      scope,
      discipline
    })
    .catch(() => [] as AchievementRarity[]);

  return (
    <div className="aqt-player flex w-full flex-col gap-3.5">
      <AchievementsView
        achievements={achievements}
        tournaments={tournaments}
        selectedTournament={withoutTournament ? "none" : tournamentId}
        showGames={showGames}
      />
    </div>
  );
};

export default UserAchievementPage;
