"use client";

import Image from "@/components/ui/image";

import type { WorkspaceListItem } from "@/types/workspace.types";

export function WorkspaceIcon({ workspace }: Readonly<{ workspace: WorkspaceListItem }>) {
  if (workspace.icon_url) {
    return (
      <Image
        src={workspace.icon_url}
        alt=""
        aria-hidden
        width={32}
        height={32}
        className="size-8 shrink-0 rounded-md border border-border object-cover"
      />
    );
  }
  return (
    <div
      aria-hidden
      className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-xs font-medium text-muted-foreground"
    >
      {workspace.name.charAt(0).toUpperCase()}
    </div>
  );
}
