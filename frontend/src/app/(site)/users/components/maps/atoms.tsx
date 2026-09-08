"use client";

import { cn } from "@/lib/utils";

import { CardSurface } from "@/app/(site)/users/components/shared/atoms";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";

export const AqtSelect = ({
  value,
  onChange,
  options,
  title,
  width = "w-[150px]"
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  title?: string;
  width?: string;
}) => (
  <Select value={value} onValueChange={onChange}>
    <SelectTrigger
      title={title}
      className={cn(
        "aqt-tnum h-8 shadow-none border-[color:var(--aqt-border)] bg-[hsl(0_0%_100%/0.02)] text-caption text-[color:var(--aqt-fg-muted)] hover:border-[color:var(--aqt-border-2)] hover:bg-[hsl(0_0%_100%/0.04)] focus:ring-1 focus:ring-[color:var(--aqt-teal)] focus:ring-offset-0",
        width
      )}
    >
      <SelectValue />
    </SelectTrigger>
    <SelectContent className="max-h-[min(var(--radix-select-content-available-height),20rem)]">
      {options.map((o) => (
        <SelectItem key={o.value} value={o.value}>
          {o.label}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

export const KPI = ({ label, value, unit, color, sub }: { label: string; value: string; unit?: string; color?: string; sub?: string }) => (
  <CardSurface>
    <div className="flex flex-col gap-1">
      <div className="text-label font-bold uppercase tracking-label text-[color:var(--aqt-fg-faint)]">{label}</div>
      <div className="aqt-display text-[38px] font-bold leading-[1.1] tabular-nums" style={{ color: color ?? "var(--aqt-fg)" }}>
        {value}
        {unit ? <span className="text-title text-[color:var(--aqt-fg-faint)]">{unit}</span> : null}
      </div>
      {sub ? <div className="aqt-tnum text-label text-[color:var(--aqt-fg-dim)]">{sub}</div> : null}
    </div>
  </CardSurface>
);
