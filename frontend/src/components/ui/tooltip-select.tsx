"use client";

import React from "react";

import { Select, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface TooltipSelectProps {
  /** The control's name: its tooltip and accessible label. */
  tooltip: string;
  value: string;
  placeholder: string;
  disabled?: boolean;
  className?: string;
  onValueChange: (value: string) => void;
  /** The `SelectContent`. */
  children: React.ReactNode;
}

/**
 * A compact Select whose label lives in a hover tooltip (and aria-label) rather
 * than a stacked caption — keeps a picker row tidy.
 */
export function TooltipSelect({
  tooltip,
  value,
  placeholder,
  disabled,
  className,
  onValueChange,
  children
}: Readonly<TooltipSelectProps>) {
  return (
    <TooltipProvider delayDuration={200}>
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <Tooltip>
          <TooltipTrigger asChild>
            <SelectTrigger aria-label={tooltip} className={cn("h-8", className)}>
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">{tooltip}</TooltipContent>
        </Tooltip>
        {children}
      </Select>
    </TooltipProvider>
  );
}
