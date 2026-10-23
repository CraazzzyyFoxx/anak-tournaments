"use client";

import { useEntityWorkspace } from "@/hooks/useEntityWorkspace";

export function EntityWorkspace({
  workspaceId,
  discipline
}: Readonly<{ workspaceId: number | null | undefined; discipline?: string | null }>) {
  useEntityWorkspace(workspaceId, discipline);
  return null;
}
