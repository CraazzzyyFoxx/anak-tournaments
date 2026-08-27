"use client";

import { CategorizedColumnPicker } from "@/components/ui/categorized-column-picker";

import type { BalancerRegistrationColumnDefinition } from "./balancerRegistrationColumns";

type BalancerRegistrationColumnCategory = BalancerRegistrationColumnDefinition["category"];

const CATEGORY_ORDER: readonly BalancerRegistrationColumnCategory[] = ["core", "meta", "admin"];

const CATEGORY_LABELS: Record<BalancerRegistrationColumnCategory, string> = {
  core: "Core",
  meta: "Meta",
  admin: "Admin",
};

interface BalancerRegistrationsColumnPickerProps {
  columns: BalancerRegistrationColumnDefinition[];
  visibility: Record<string, boolean>;
  onToggle: (id: string) => void;
  onReset: () => void;
}

export default function BalancerRegistrationsColumnPicker({
  columns,
  visibility,
  onToggle,
  onReset,
}: Readonly<BalancerRegistrationsColumnPickerProps>) {
  return (
    <CategorizedColumnPicker<BalancerRegistrationColumnCategory, BalancerRegistrationColumnDefinition>
      columns={columns}
      categories={CATEGORY_ORDER}
      categoryLabel={(category) => CATEGORY_LABELS[category]}
      visibility={visibility}
      onToggle={onToggle}
      onReset={onReset}
      triggerLabel="Columns"
      resetLabel="Reset to defaults"
    />
  );
}
