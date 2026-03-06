import React from "react";
import type { ReactNode } from "react";

export interface StatisticsCardProps {
  name: string;
  value: number | string;
  icon?: ReactNode;
  iconClassName?: string;
}

const StatisticsCard = ({
  name,
  value,
  icon,
  iconClassName = "bg-white/5 text-white/40"
}: StatisticsCardProps) => {
  const formattedValue =
    typeof value === "number" && Number.isFinite(value)
      ? new Intl.NumberFormat("en-US").format(value)
      : value;

  return (
    <div className="relative rounded-xl border border-white/[0.07] bg-white/[0.02] px-5 py-4 flex flex-col gap-3 hover:bg-white/[0.04] transition-colors duration-200">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-white/50">{name}</p>
        {icon && (
          <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${iconClassName}`}>
            {icon}
          </div>
        )}
      </div>
      <div className="text-3xl font-bold tabular-nums tracking-tight text-white">
        {formattedValue}
      </div>
    </div>
  );
};

export default StatisticsCard;
