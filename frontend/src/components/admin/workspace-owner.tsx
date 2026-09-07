"use client";

import { useQuery } from "@tanstack/react-query";

import workspaceService from "@/services/workspace.service";

/**
 * Who is accountable for a workspace, as one inline line.
 *
 * Its own fetch rather than a field on the workspace row: `Workspace` comes
 * from the anonymous, edge-cached `/api/v1/workspaces` reads, which publish no
 * owner at all — resolving `owner_id` to a name and an email needs the
 * `workspace.update`-gated `/owner` endpoint. Inline-only markup (spans, never
 * a block) because both call sites drop it inside a `<p>`.
 *
 * `retry: false` and a silent `—` on error are deliberate: a caller who lacks
 * the permission gets a 403, and an informational field must not turn a
 * settings page into an error state over it.
 */
export function WorkspaceOwnerValue({ workspaceId }: Readonly<{ workspaceId: number | null }>) {
  const query = useQuery({
    queryKey: ["workspace-owner", workspaceId],
    queryFn: () => workspaceService.getOwner(workspaceId as number),
    enabled: workspaceId != null,
    retry: false,
    staleTime: 5 * 60 * 1000
  });

  if (workspaceId == null || query.isPending) {
    return <span className="text-muted-foreground">…</span>;
  }
  if (query.isError) {
    return <span className="text-muted-foreground">—</span>;
  }
  const owner = query.data;
  if (!owner) {
    return <span className="text-muted-foreground">No owner recorded</span>;
  }

  return (
    <span>
      {owner.username ? `@${owner.username}` : `#${owner.auth_user_id}`}
      {owner.email ? <span className="text-muted-foreground"> · {owner.email}</span> : null}
    </span>
  );
}
