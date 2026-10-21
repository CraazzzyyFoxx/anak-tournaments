"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { useTranslations } from "next-intl";

import { ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { useFormatter } from "@/lib/datetime/client";
import type { RankSeries } from "@/types/rank.types";

import { chartRows, isLone, type LolQueue } from "./lol-rank";

/** What recharts hands a `dot` render function: the point's place among every point of its line. */
type DotArgs = { key: string; index: number; cx: number; cy: number; points: ReadonlyArray<{ value?: number | null }> };

/** A dot only on a ranked point between gaps: a step line has no segment to draw there. */
function loneDot(queue: LolQueue, { key, index, cx, cy, points }: DotArgs) {
  return isLone(points, index) ? (
    <circle key={key} cx={cx} cy={cy} r={3} fill={`var(--color-${queue})`} />
  ) : (
    <g key={key} />
  );
}

/** Solo/Duo and Flex as two step series over time; a gap is a stretch with no ranked account. */
export default function LolRankChart({ series }: Readonly<{ series: RankSeries[] }>) {
  const t = useTranslations("rankHistory.lol");
  const format = useFormatter();
  const config: ChartConfig = {
    solo: { label: t("solo"), color: "hsl(var(--chart-1))" },
    flex: { label: t("flex"), color: "hsl(var(--chart-2))" }
  };
  return (
    <ChartContainer config={config} className="h-64 w-full">
      <LineChart data={chartRows(series)} margin={{ left: 4, right: 12 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="at" type="number" scale="time" domain={["dataMin", "dataMax"]}
          tickFormatter={(value: number) => format.dateTime(new Date(value), { month: "short", day: "numeric" })} />
        <YAxis width={44} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Line dataKey="solo" type="stepAfter" stroke="var(--color-solo)" dot={(props: DotArgs) => loneDot("solo", props)} />
        <Line dataKey="flex" type="stepAfter" stroke="var(--color-flex)" dot={(props: DotArgs) => loneDot("flex", props)} />
      </LineChart>
    </ChartContainer>
  );
}
