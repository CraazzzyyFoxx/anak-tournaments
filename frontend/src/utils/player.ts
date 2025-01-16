import { Player } from "@/types/team.types";
import { User, UserProfile } from "@/types/user.types";

export const getPlayerType = (player: Player) => {
  let type = "ㅤ";
  if (player.role == "Damage" && player.primary) {
    type = "Hitscan";
  }
  if (player.role == "Damage" && player.secondary) {
    type = "Projectile";
  }
  if (player.role == "Support" && player.primary) {
    type = "Main Heal";
  }
  if (player.role == "Support" && player.secondary) {
    type = "Light Heal";
  }
  return type;
};

export const sortTeamPlayers = (players: Player[]) => {
  const formatedPlayers = players.map((player) => {
    let priority = 1;
    if (player.role === "Damage") {
      priority = 2;
    }
    if (player.role === "Support") {
      priority = 3;
    }
    return { ...player, priority };
  });

  return formatedPlayers.sort((a, b) => {
    // Sort by priority (role order: Tank > Damage > Support)
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }

    // Ensure substitutions are sorted below the player they replace
    if (a.relative_player || b.relative_player) {
      if (a.relative_player !== b.relative_player) {
        return a.relative_player - b.relative_player;
      }
      return Number(a.is_substitution) - Number(b.is_substitution);
    }

    // Sort by rank within the same role (excluding substitutions)
    if (!a.is_substitution && !b.is_substitution) {
      return b.rank - a.rank;
    }

    // Keep substitutions relative to their main players
    return 0;
  });
};

export const getPlayerImage = (profile: UserProfile, user: User) => {
  if (profile.most_played_hero === null) {
    return `/avatar/${user.id % 10}.png`;
  }

  const slug = profile.most_played_hero.slug;
  // if (["mauga", "juno", "junker-queen", "kiriko", "lifeweaver", "baptiste", "sojourn", "echo", "ramattra", "wrecking-ball", "venture", "illari", "ashe", "hazard"].includes(slug)) {
  //   return `/avatar/${profile.user.id % 10}.png`;
  // }
  return `/avatar/${profile.most_played_hero.slug}.jpg`;
  // return profile.most_played_hero.image_path
};
