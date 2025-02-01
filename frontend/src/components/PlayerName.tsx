import React from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Player } from "@/types/team.types";
import { getPlayerType } from "@/utils/player";
import { User } from "@/types/user.types";

const PlayerName = ({
  player,
  includeSpecialization,
  excludeBadge
}: {
  player: Player | User;
  includeSpecialization: boolean;
  excludeBadge?: boolean;
}) => {
  const name = player.name.split("#")[0];
  const tag = player.name.split("#")[1];

  return (
    <div className="flex flex-col">
      <div className="flex flex-row gap-1 items-center">
        <Link href={`/users/${player.name.replace("#", "-")}`}>
          <h4 className="text-base font-semibold">{name}</h4>
        </Link>
        {(tag && !excludeBadge) && (
          <Badge variant="secondary" className="px-1 text-xs">
            <p className="text-muted-foreground">{`#${tag}`}</p>
          </Badge>
        )}
      </div>
      <div>
        {includeSpecialization && (
          // @ts-ignore
          <p className="text-xs text-muted-foreground">{getPlayerType(player)}</p>
        )}
      </div>
    </div>
  );
};

export default PlayerName;
