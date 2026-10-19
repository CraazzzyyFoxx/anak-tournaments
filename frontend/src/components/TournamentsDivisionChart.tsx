"use client";

import { useMemo } from "react";
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
import { useRoleName } from "@/hooks/useRoleName";
import { orderedRoleCodes, roleTint, slotLabel } from "@/lib/roster/ontology";
import type { DisciplineMetadata } from "@/types/discipline.types";
import type { TournamentDivisionStatistics } from "@/types/statistics.types";

/** One line per role the game's tournaments actually report, named and tinted by that game's ontology. */
const TournamentsDivisionChart = ({
  data,
  ontology,
  title
}: {
  data: TournamentDivisionStatistics[];
  ontology: DisciplineMetadata | null;
  title: string;
}) => {
  const nameOf = useRoleName();
  const codes = useMemo(
    () => orderedRoleCodes(ontology, data.flatMap((item) => Object.keys(item.role_avg_divs))),
    [data, ontology]
  );

  // Series keys are positional: role codes are data, not safe CSS custom-property names.
  const chartConfig = useMemo<ChartConfig>(
    () => ({
      name: { label: "Tournament" },
      ...Object.fromEntries(
        codes.map((code, index) => [
          `role${index}`,
          { label: slotLabel(ontology, code, code, nameOf), color: roleTint(ontology, code) }
        ])
      )
    }),
    [codes, ontology, nameOf]
  );

  const chartData = useMemo(
    () =>
      data.map((item) => ({
        name: item.name,
        ...Object.fromEntries(
          codes.map((code, index) => {
            const value = item.role_avg_divs[code];
            return [`role${index}`, value !== undefined && value > 0 ? value : null];
          })
        )
      })),
    [data, codes]
  );

  const [minDivision, maxDivision] = useMemo(() => {
    const values = data.flatMap((item) => Object.values(item.role_avg_divs).filter((value) => value > 0));
    if (values.length === 0) {
      return [0, 1] as const;
    }
    return [Math.floor(Math.min(...values) - 1), Math.ceil(Math.max(...values) + 1)] as const;
  }, [data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig}>
          <LineChart accessibilityLayer data={chartData}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="name" tickLine={false} tickMargin={10} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent className="w-37.5" />} />
            <YAxis tickLine={false} axisLine={false} domain={[minDivision, maxDivision]} tickCount={3} />
            {codes.map((code, index) => (
              <Line
                key={code}
                dataKey={`role${index}`}
                type="natural"
                stroke={`var(--color-role${index})`}
                strokeWidth={2}
                dot={true}
              />
            ))}
            <ChartLegend content={<ChartLegendContent />} />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
};

export default TournamentsDivisionChart;
