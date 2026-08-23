"use client";

import * as React from "react";
import { CalendarIcon } from "lucide-react";
import { useFormatter, type DateTimeFormatOptions } from "next-intl";
import { type DateRange } from "react-day-picker";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * The slice of next-intl's formatter this trigger needs. `useFormatter()` and
 * `await getFormatter()` both satisfy it, so `formatDisplay` never has to pin a
 * locale of its own.
 */
interface DateFormatter {
  dateTime: (value: Date, options?: DateTimeFormatOptions) => string;
}

interface DateRangePickerProps {
  startDate?: string;
  endDate?: string;
  onChange: (startDate: string, endDate: string) => void;
  placeholder?: string;
  id?: string;
}

function formatDisplay(format: DateFormatter, date: Date): string {
  return format.dateTime(date, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function parseDateValue(value?: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function DateRangePicker({
  startDate,
  endDate,
  onChange,
  placeholder = "Pick a date range",
  id,
}: Readonly<DateRangePickerProps>) {
  const format = useFormatter();
  const [open, setOpen] = React.useState(false);

  const from = React.useMemo(() => parseDateValue(startDate), [startDate]);
  const to = React.useMemo(() => parseDateValue(endDate), [endDate]);

  const selected: DateRange | undefined =
    from || to ? { from, to } : undefined;

  const displayText = React.useMemo(() => {
    if (from && to) return `${formatDisplay(format, from)} - ${formatDisplay(format, to)}`;
    if (from) return formatDisplay(format, from);
    return "";
  }, [format, from, to]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          data-empty={!from}
          className={cn(
            "w-full justify-start text-left font-normal",
            "data-[empty=true]:text-muted-foreground"
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {displayText || <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          defaultMonth={from}
          selected={selected}
          onSelect={(range) => {
            onChange(range?.from ? toIsoDate(range.from) : "", range?.to ? toIsoDate(range.to) : "");
          }}
          numberOfMonths={2}
        />
      </PopoverContent>
    </Popover>
  );
}
