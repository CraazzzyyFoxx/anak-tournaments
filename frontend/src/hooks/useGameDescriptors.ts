"use client";

import { useMemo } from "react";

import { useDisciplines } from "@/hooks/useDisciplineMetadata";
import type { DisciplineDescriptor } from "@/types/discipline.types";

/** Every installed game by code (axis `all`): names and marks for cross-game rows and the pill. */
export function useGameDescriptors(): Map<string, DisciplineDescriptor> {
  const { data } = useDisciplines("all");
  return useMemo(() => new Map((data ?? []).map((descriptor) => [descriptor.code, descriptor])), [data]);
}
