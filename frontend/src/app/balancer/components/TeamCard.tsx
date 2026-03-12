"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TeamData } from "@/types/balancer.types";
import { Badge } from "@/components/ui/badge";
import { Users, TrendingUp, AlertCircle, Crown } from "lucide-react";
import PlayerCard from "./PlayerCard";

interface TeamCardProps {
  team: TeamData;
}

const TeamCard = ({ team }: TeamCardProps) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {team.name}
          </span>
          <Badge variant="outline" className="font-medium text-lg">
            {team.avgMMR.toFixed(0)} MMR
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Team Stats */}
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="flex items-center gap-1 text-muted-foreground">
            <TrendingUp className="h-4 w-4" />
            <span>Variance: {team.variance.toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-1 text-muted-foreground">
            <AlertCircle className="h-4 w-4" />
            <span>Discomfort: {team.totalDiscomfort}</span>
          </div>
        </div>

        {/* Roster */}
        <div className="space-y-2">
          {Object.entries(team.roster).flatMap(([role, players]) =>
            players.map((player) => <PlayerCard key={player.uuid} player={player} role={role} />)
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default TeamCard;
