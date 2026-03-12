import React from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Handshake } from "lucide-react";
import { TypographyH4 } from "@/components/ui/typography";
import { UserBestTeammate } from "@/types/user.types";
import PlayerName from "@/components/PlayerName";

export interface UserBestTeammatesProps {
  teammates: UserBestTeammate[];
  className?: string;
}

const UserBestTeammates = ({ teammates, className }: UserBestTeammatesProps) => {
  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex flex-row gap-2 items-center align-text-top">
          <Handshake />
          <TypographyH4>Best Teammates</TypographyH4>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {teammates.map((teammate) => (
          <div
            key={teammate.user.id}
            className="rounded-lg p-3 transition-colors hover:bg-muted/30"
          >
            <div className="flex flex-row justify-between items-center">
              <PlayerName player={teammate.user} includeSpecialization={false} />
              <p className="text-sm text-muted-foreground tabular-nums">
                {teammate.tournaments} times
              </p>
            </div>
            <div className="flex flex-row justify-between mt-1">
              <div>
                <p className="text-xs text-muted-foreground font-semibold">KDA</p>
                <p className="text-sm font-semibold tabular-nums">{teammate.stats.kda}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-semibold">MVP Score</p>
                <p className="text-sm font-semibold text-center tabular-nums">
                  {teammate.stats.performance}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-semibold">Win ratio</p>
                <p className="text-sm font-semibold text-center tabular-nums">
                  {(teammate.winrate * 100).toFixed(0)}%
                </p>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};

export default UserBestTeammates;
