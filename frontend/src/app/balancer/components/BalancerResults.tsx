"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BalanceResponse } from "@/types/balancer.types";
import StatisticsCard from "@/components/StatisticsCard";
import TeamCard from "./TeamCard";

interface BalancerResultsProps {
  results: BalanceResponse;
}

const BalancerResults = ({ results }: BalancerResultsProps) => {
  const { teams, statistics } = results;

  return (
    <div className="space-y-6">
      {/* Statistics Overview */}
      <div>
        <h2 className="text-2xl font-bold mb-4">Balance Statistics</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatisticsCard name="Total Teams" value={statistics.totalTeams} />
          <StatisticsCard name="Players per Team" value={statistics.playersPerTeam} />
          <StatisticsCard name="Average MMR" value={statistics.averageMMR.toFixed(0)} />
          <StatisticsCard name="MMR Std Dev" value={statistics.mmrStdDev.toFixed(2)} />
        </div>
      </div>

      {/* Teams */}
      <div>
        <h2 className="text-2xl font-bold mb-4">Balanced Teams</h2>
        <div className="grid gap-4 lg:grid-cols-3">
          {teams.map((team) => (
            <TeamCard key={team.id} team={team} />
          ))}
        </div>
      </div>
    </div>
  );
};

export default BalancerResults;
