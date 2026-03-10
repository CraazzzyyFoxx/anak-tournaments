"use client";

import * as React from "react";
import { CalendarIcon } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface DatePickerProps {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
}

function formatDate(date: Date | undefined) {
  if (!date) {
    return "";
  }

  return date.toLocaleDateString("en-US", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function isValidDate(date: Date | undefined) {
  if (!date) {
    return false;
  }

  return !Number.isNaN(date.getTime());
}

function parseDateValue(value?: string) {
  if (!value) {
    return undefined;
  }

  const date = new Date(`${value}T00:00:00`);
  return isValidDate(date) ? date : undefined;
}

function toIsoDate(date: Date | undefined) {
  if (!date) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function DatePicker({
  value,
  onChange,
  placeholder = "June 01, 2025",
  id,
}: DatePickerProps) {
  const parsedValue = React.useMemo(() => parseDateValue(value), [value]);
  const [open, setOpen] = React.useState(false);
  const [date, setDate] = React.useState<Date | undefined>(parsedValue);
  const [month, setMonth] = React.useState<Date | undefined>(parsedValue);
  const [inputValue, setInputValue] = React.useState(formatDate(parsedValue));

  React.useEffect(() => {
    setDate(parsedValue);
    setMonth(parsedValue);
    setInputValue(formatDate(parsedValue));
  }, [parsedValue]);

  return (
    <InputGroup>
      <InputGroupInput
        id={id}
        value={inputValue}
        placeholder={placeholder}
        onChange={(event) => {
          const nextValue = event.target.value;
          const nextDate = new Date(nextValue);

          setInputValue(nextValue);

          if (!nextValue) {
            setDate(undefined);
            setMonth(undefined);
            onChange("");
            return;
          }

          if (isValidDate(nextDate)) {
            setDate(nextDate);
            setMonth(nextDate);
            onChange(toIsoDate(nextDate));
          }
        }}
        onBlur={() => {
          if (!inputValue) {
            return;
          }

          const nextDate = new Date(inputValue);

          if (!isValidDate(nextDate)) {
            setInputValue(formatDate(date));
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      />
      <InputGroupAddon align="inline-end">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <InputGroupButton
              variant="ghost"
              size="icon-xs"
              aria-label="Select date"
            >
              <CalendarIcon />
              <span className="sr-only">Select date</span>
            </InputGroupButton>
          </PopoverTrigger>
          <PopoverContent
            className="w-auto overflow-hidden p-0"
            align="end"
            alignOffset={-8}
            sideOffset={10}
          >
            <Calendar
              mode="single"
              selected={date}
              month={month}
              onMonthChange={setMonth}
              onSelect={(selectedDate) => {
                setDate(selectedDate);
                setMonth(selectedDate);
                setInputValue(formatDate(selectedDate));
                onChange(toIsoDate(selectedDate));
                setOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
      </InputGroupAddon>
    </InputGroup>
  );
}
