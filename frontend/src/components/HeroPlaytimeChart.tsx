"use client";

import React, { useMemo } from "react";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent
} from "@/components/ui/chart";
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { HeroPlaytime } from "@/types/hero.types";

export interface HeroPlaytimeChartProps {
  heroes: HeroPlaytime[];
}

const HeroPlaytimeChart = ({ heroes }: HeroPlaytimeChartProps) => {
  const chartData = useMemo(() => {
    return heroes.map((heroPlaytime) => {
      return {
        name: heroPlaytime.hero.slug,
        value: heroPlaytime.playtime * 100,
        fill: `var(--color-${heroPlaytime.hero.slug})`,
        icon: heroPlaytime.hero.image_path
      };
    });
  }, [heroes]);

  const heroesIcons: Map<string, string> = useMemo(() => {
    const icons = new Map<string, string>();
    heroes.forEach((heroPlaytime) => {
      icons.set(heroPlaytime.hero.slug, heroPlaytime.hero.image_path);
    });
    return icons;
  }, [heroes]);

  // @ts-ignore
  const CustomYAxisTick = ({ x, y, payload }) => {
    return (
      <g transform={`translate(${x},${y})`}>
        <image href={heroesIcons.get(payload.value)} x={-20} y={-15} height={30} width={30} />
      </g>
    );
  };

  const chartConfig: ChartConfig = useMemo(() => {
    const charData = {
      value: {
        label: "Percentage of play time on the hero"
      }
    };
    heroes.forEach((heroPlaytime) => {
      // @ts-ignore
      charData[heroPlaytime.hero.slug] = {
        label: heroPlaytime.hero.name,
        color: heroPlaytime.hero.color
      };
    });
    return charData;
  }, [heroes]);

  return (
    <ChartContainer config={chartConfig}>
      <ResponsiveContainer width={"100%"} height={"100%"}>
        <BarChart
          accessibilityLayer
          data={chartData}
          layout="vertical"
          margin={{
            left: 0
          }}
        >
          <YAxis
            dataKey="name"
            type="category"
            tickLine={false}
            tickMargin={10}
            axisLine={false}
            // @ts-ignore
            tick={<CustomYAxisTick />}
          />
          <XAxis dataKey="value" type="number" hide />
          <ChartTooltip content={<ChartTooltipContent className="w-[250px]" nameKey="value" />} />
          <Bar dataKey="value" layout="vertical" radius={5} />
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
};

export default HeroPlaytimeChart;
