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
      <CardContent>
        {teammates.map((teammate, index) => (
          <div key={index} className="p-2">
            <div className="flex flex-row justify-between">
              <PlayerName player={teammate.user} includeSpecialization={false} />
              <p className="text-sm text-muted-foreground">{teammate.tournaments} times</p>
            </div>
            <div className="flex flex-row justify-between mt-1">
              <div>
                <p className="text-xs text-muted-foreground font-semibold">KDA</p>
                <p className="text-sm font-semibold text-s">{teammate.stats.kda}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-semibold">MVP</p>
                <p className="text-sm font-semibold">{teammate.stats.performance}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-semibold">Win ratio</p>
                <p className="text-sm font-semibold">{(teammate.winrate * 100).toFixed(0)}%</p>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};

export default UserBestTeammates;
