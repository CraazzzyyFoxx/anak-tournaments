"use client";

import { useTranslations } from "next-intl";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useDisciplineLabel } from "../_hooks/useDisciplineLabel";

/**
 * The game the catalog below is about. Hidden for a workspace that runs one
 * game. Disabled while a form is open: a half-written create form or an edit
 * belongs to the game it was opened for, and leaving it goes through the
 * dialog's own unsaved-changes prompt rather than a silent switch.
 */
export function DisciplineSelect({
  value,
  disciplines,
  onChange,
  disabled,
}: Readonly<{
  value: string | null;
  disciplines: string[];
  onChange: (discipline: string) => void;
  disabled?: boolean;
}>) {
  const t = useTranslations("adminAchievements");
  const label = useDisciplineLabel();
  if (disciplines.length < 2 || value === null) return null;

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="w-52" aria-label={t("discipline.select")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {disciplines.map((discipline) => (
          <SelectItem key={discipline} value={discipline}>
            {label(discipline)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
