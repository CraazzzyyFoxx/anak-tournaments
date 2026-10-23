"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useTranslations } from "next-intl";
import type { MappingTargetMode } from "@/types/balancer-admin.types";

const DEFAULT_MODES: MappingTargetMode[] = ["columns", "constant", "disabled"];

interface ModeToggleProps {
  value: MappingTargetMode;
  onChange: (mode: MappingTargetMode) => void;
  availableModes?: MappingTargetMode[];
  disabled?: boolean;
}

export function ModeToggle({ value, onChange, availableModes, disabled }: Readonly<ModeToggleProps>) {
  const t = useTranslations("sheetsFeed.controls");
  const modes = availableModes ?? DEFAULT_MODES;
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next && next !== value) {
          onChange(next as MappingTargetMode);
        }
      }}
      variant="outline"
      size="sm"
    >
      {modes.map((mode) => (
        <ToggleGroupItem key={mode} value={mode} disabled={disabled} className="px-3">
          {t(`modes.${mode}`)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
