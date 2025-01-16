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
import { Bar, ComposedChart, Line, XAxis, YAxis } from "recharts";
import { TournamentStatistics } from "@/types/statistics.types";

const chartConfig = {
  tournament: {
    label: "Tournament"
  },
  avg_sr: {
    label: "Avg. team value",
    color: "#2563eb"
  },
  players_count: {
    label: "Players count",
    color: "#f28e1c"
  },
  avg_closeness: {
    label: "Avg. match balance",
    color: "#6d398b"
  }
} satisfies ChartConfig;

const TournamentsChart = ({ data }: { data: TournamentStatistics[] }) => {
  const chartData = useMemo(() => {
    return data.map((item) => {
      return {
        number: item.number.toString(),
        players_count: item.players_count,
        avg_sr: item.avg_sr,
        avg_closeness: item.avg_closeness * 100
      };
    });
  }, [data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>History of tournament changes</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig}>
          <ComposedChart accessibilityLayer data={chartData}>
            <XAxis dataKey="number" tickLine={true} tickMargin={10} axisLine={true} />
            <YAxis
              yAxisId="left"
              dataKey="players_count"
              tickLine={true}
              axisLine={true}
              tickCount={3}
            />
            <YAxis
              yAxisId="right"
              dataKey="avg_sr"
              orientation="right"
              tickLine={true}
              axisLine={true}
              tickCount={3}
            />
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
            <Bar
              dataKey="players_count"
              yAxisId="left"
              fill="var(--color-players_count)"
              radius={4}
              barSize={10}
            />
            <Bar
              dataKey="avg_closeness"
              yAxisId="left"
              fill="var(--color-avg_closeness)"
              radius={4}
              barSize={10}
            />
            <Line
              dataKey="avg_sr"
              yAxisId="right"
              type="natural"
              stroke="var(--color-avg_sr)"
              strokeWidth={2}
              dot={true}
            />
            <ChartLegend content={<ChartLegendContent />} />
          </ComposedChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
};

export default TournamentsChart;
