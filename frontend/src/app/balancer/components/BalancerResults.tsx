"use client";

import React, { useState } from "react";
import { Clipboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { BalanceResponse } from "@/types/balancer.types";
import StatisticsCard from "@/components/StatisticsCard";
import TeamCard from "./TeamCard";

interface BalancerResultsProps {
  results: BalanceResponse;
}

const BalancerResults = ({ results }: BalancerResultsProps) => {
  const { teams, statistics, appliedConfig } = results;
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [copiedConfig, setCopiedConfig] = useState(false);

  const handleCopyConfig = async () => {
    if (!appliedConfig) {
      return;
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(appliedConfig, null, 2));
      setCopiedConfig(true);

      window.setTimeout(() => {
        setCopiedConfig(false);
      }, 1500);
    } catch {
      setCopiedConfig(false);
    }
  };

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

      {appliedConfig && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>Applied Config</CardTitle>
            <Button variant="outline" size="sm" onClick={handleCopyConfig}>
              <Clipboard className="h-3.5 w-3.5" />
              {copiedConfig ? "Copied" : "Copy"}
            </Button>
          </CardHeader>
          <CardContent>
            <Collapsible open={isConfigOpen} onOpenChange={setIsConfigOpen}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Snapshot of the exact settings used for this balancing run.
                </p>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" type="button">
                    {isConfigOpen ? "Hide" : "Show"}
                  </Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>
                <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
                  {JSON.stringify(appliedConfig, null, 2)}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default BalancerResults;
