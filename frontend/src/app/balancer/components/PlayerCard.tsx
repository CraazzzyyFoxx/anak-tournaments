"use client";

import React from "react";
import { PlayerData } from "@/types/balancer.types";
import { Crown, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import PlayerDivisionIcon from "@/components/PlayerDivisionIcon";

interface PlayerCardProps {
  player: PlayerData;
  role: string;
}

const rank_to_div = (player: PlayerData) => {
  let div = 20 - player.rating / 100 + 1;
  div = Math.max(div, 1);
  return Math.round(div);
};

const PlayerCard = ({ player, role }: PlayerCardProps) => {
  return (
    <div
      className={cn(
        "flex items-center justify-between p-3 rounded-lg border bg-card transition-colors hover:bg-accent",
        player.isCaptain && "border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20"
      )}
    >
      <div className="flex items-center gap-3 flex-1">
        <PlayerRoleIcon role={role} size={22} />
        {player.isCaptain && <Crown className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />}
        <div className="flex-1">
          <div className="font-medium">{player.name}</div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {player.discomfort > 0 && (
              <span className="text-orange-600 dark:text-orange-400">Offrole</span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {player.preferences.length > 0 && (
          <div className="flex items-center gap-1">
            <div className="flex flex-row items-center gap-1">
              {player.preferences.map((pref, index) => (
                <span key={index} className="flex flex-row">
                  <PlayerRoleIcon role={pref} size={16} />
                </span>
              ))}
            </div>
          </div>
        )}
        <PlayerDivisionIcon division={rank_to_div(player)} width={32} height={32} />
      </div>
    </div>
  );
};

export default PlayerCard;
