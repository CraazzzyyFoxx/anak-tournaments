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
  const getRolePriority = (role: string) => {
    if (role === "Tank") return 1;
    if (role === "Damage") return 2;
    if (role === "Support") return 3;
    return 4;
  };

  const playerById = new Map(players.map((p) => [p.id, p]));

  // Build substitution graph: parent -> children (who replaced them)
  const children = new Map<number, Player[]>();
  const roots: Player[] = [];

  for (const player of players) {
    if (player.is_substitution && playerById.has(player.relative_player)) {
      const list = children.get(player.relative_player) ?? [];
      list.push(player);
      children.set(player.relative_player, list);
    } else {
      roots.push(player);
    }
  }

  // Sort children at each node by rank descending
  for (const list of children.values()) {
    list.sort((a, b) => b.rank - a.rank);
  }

  // DFS: flatten each substitution chain (player, then their replacements)
  const flatten = (player: Player): Player[] => {
    const result = [player];
    const subs = children.get(player.id);
    if (subs) {
      for (const sub of subs) {
        result.push(...flatten(sub));
      }
    }
    return result;
  };

  // Sort roots by role priority, then by rank within same role
  roots.sort((a, b) => {
    const rp = getRolePriority(a.role) - getRolePriority(b.role);
    if (rp !== 0) return rp;
    return b.rank - a.rank;
  });

  // Flatten: each root followed by its substitution chain
  return roots.flatMap(flatten);
};

export const getPlayerImage = (profile: UserProfile, user: User) => {
  if (profile.most_played_hero === null) {
    return `/avatar/${user.id % 10}.png`;
  }

  // if (["mauga", "juno", "junker-queen", "kiriko", "lifeweaver", "baptiste", "sojourn", "echo", "ramattra", "wrecking-ball", "venture", "illari", "ashe", "hazard"].includes(slug)) {
  //   return `/avatar/${profile.user.id % 10}.png`;
  // }
  return `/avatar/${profile.most_played_hero.slug}.jpg`;
  // return profile.most_played_hero.image_path
};

export const getPlayerSlug = (battleTag: string | null | undefined) => {
  if (!battleTag) {
    return "";
  }
  return battleTag.replace("#", "-");
};

/** Reverse of getPlayerSlug: converts a URL slug back to the stored player name.
 *  "CraazzzyyFox-2130" → "CraazzzyyFox#2130"
 *  Names without a numeric suffix are returned unchanged.
 */
export const decodePlayerSlug = (slug: string): string => {
  let decodedSlug = slug;

  try {
    decodedSlug = decodeURIComponent(slug);
  } catch {
    decodedSlug = slug;
  }

  return decodedSlug.replace(/-(\d+)$/, "#$1");
};
