"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AuthUserSearchCombobox } from "@/components/admin/AuthUserSearchCombobox";
import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";
import workspaceService from "@/services/workspace.service";

/**
 * Shared cache contract for the owner of one workspace.
 *
 * Both the read-only line and the superuser control read it, and the control
 * writes the mutation result straight back into it — so the key and the fetch
 * policy have to live in one place or the two consumers end up on separate
 * cache entries that disagree.
 */
function useWorkspaceOwner(workspaceId: number | null) {
  return useQuery({
    queryKey: ["workspace-owner", workspaceId],
    queryFn: () => workspaceService.getOwner(workspaceId as number),
    enabled: workspaceId != null,
    retry: false,
    staleTime: 5 * 60 * 1000
  });
}

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
  const query = useWorkspaceOwner(workspaceId);

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

/**
 * Superuser-only owner reassignment. Renders nothing for anyone else — the
 * backend refuses the write for a workspace admin too, because `owner_id` is
 * what the per-account workspace cap is counted over.
 *
 * Picking an account assigns it immediately, like the tier `Select` next to it:
 * there is nothing to stage, and a Save button over a single field would only
 * add a state that can be abandoned half-set.
 */
export function WorkspaceOwnerControl({
  workspaceId,
  isSuperuser
}: Readonly<{ workspaceId: number | null; isSuperuser: boolean }>) {
  const queryClient = useQueryClient();
  const owner = useWorkspaceOwner(workspaceId).data;

  const mutation = useMutation({
    mutationFn: (authUserId: number | null) =>
      workspaceService.setOwner(workspaceId as number, authUserId),
    onSuccess: (next) => {
      queryClient.setQueryData(["workspace-owner", workspaceId], next);
      notify.success(
        next ? `Owner set to ${next.username ? `@${next.username}` : `#${next.auth_user_id}`}` : "Owner cleared"
      );
    },
    onError: (error) => notify.apiError(error, { title: "Could not change the owner" })
  });

  if (!isSuperuser || workspaceId == null) return null;

  return (
    <div className="mt-3">
      <label htmlFor="workspace-owner" className="text-sm font-medium leading-none">
        Reassign owner
      </label>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <AuthUserSearchCombobox
          id="workspace-owner"
          value={owner?.auth_user_id}
          selectedLabel={owner?.username ?? owner?.email ?? undefined}
          onSelect={(account) => mutation.mutate(account?.id ?? null)}
          placeholder="Select an account"
          disabled={mutation.isPending}
        />
        {owner ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate(null)}
          >
            Clear
          </Button>
        ) : null}
      </div>
      <p className="mt-1 max-w-prose text-xs text-muted-foreground">
        Superusers only, and audited. This moves the accountability stamp alone: workspace roles
        are unchanged, so grant or revoke the “owner” role in Members separately.
      </p>
    </div>
  );
}
