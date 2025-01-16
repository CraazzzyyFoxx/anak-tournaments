"use client";

import React, { useMemo } from "react";
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent
} from "@/components/ui/chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { TournamentDivisionStatistics } from "@/types/statistics.types";

const chartConfig = {
  number: {
    label: "Tournament"
  },
  tank_avg_div: {
    label: "Tank",
    color: "#7d92cc"
  },
  damage_avg_div: {
    label: "Damage",
    color: "#f28e1c"
  },
  support_avg_div: {
    label: "Support",
    color: "#f7a0cc"
  }
} satisfies ChartConfig;

const TournamentsDivisionChart = ({ data }: { data: TournamentDivisionStatistics[] }) => {
  const chartData = useMemo(() => {
    return data.map((item) => {
      return {
        number: item.number.toString(),
        tank_avg_div: item.tank_avg_div,
        damage_avg_div: item.damage_avg_div,
        support_avg_div: item.support_avg_div
      };
    });
  }, [data]);

  const minDivision = useMemo(() => {
    let minDiv = 20;
    for (const item of data || []) {
      if (item.tank_avg_div < minDiv) {
        minDiv = item.tank_avg_div;
      }
      if (item.damage_avg_div < minDiv) {
        minDiv = item.damage_avg_div;
      }
      if (item.support_avg_div < minDiv) {
        minDiv = item.support_avg_div;
      }
    }
    return Number((minDiv - 1).toFixed(0));
  }, [data]);

  const maxDivision = useMemo(() => {
    let maxDiv = 1;
    for (const item of data || []) {
      if (item.tank_avg_div > maxDiv) {
        maxDiv = item.tank_avg_div;
      }
      if (item.damage_avg_div > maxDiv) {
        maxDiv = item.damage_avg_div;
      }
      if (item.support_avg_div > maxDiv) {
        maxDiv = item.support_avg_div;
      }
    }
    return Number((maxDiv + 1).toFixed());
  }, [data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Average division by roles</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig}>
          <LineChart accessibilityLayer data={chartData}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="number" tickLine={false} tickMargin={10} axisLine={false} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  className="w-[150px]"
                  labelFormatter={(value) => {
                    return `Tournament ${value}`;
                  }}
                />
              }
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              domain={[minDivision, maxDivision]}
              tickCount={3}
            />
            <Line
              dataKey="tank_avg_div"
              type="natural"
              stroke="var(--color-tank_avg_div)"
              strokeWidth={2}
              dot={true}
            />
            <Line
              dataKey="damage_avg_div"
              type="natural"
              stroke="var(--color-damage_avg_div)"
              strokeWidth={2}
              dot={true}
            />
            <Line
              dataKey="support_avg_div"
              type="natural"
              stroke="var(--color-support_avg_div)"
              strokeWidth={2}
              dot={true}
            />
            <ChartLegend content={<ChartLegendContent />} />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
};

export default TournamentsDivisionChart;
