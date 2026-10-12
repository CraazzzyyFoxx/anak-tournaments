"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { AuthUserSearchCombobox, type AuthUserOption } from "@/components/kit/AuthUserSearchCombobox";
import { ConfirmDialog } from "@/components/kit/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";
import workspaceService from "@/services/workspace.service";
import { useAuthProfileStore } from "@/stores/auth-profile.store";
import { adminQueryKeys } from "@/lib/admin/query-keys";

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
    queryKey: adminQueryKeys.workspaceOwner(workspaceId),
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
  const t = useTranslations("adminAccess.common");
  const query = useWorkspaceOwner(workspaceId);

  if (workspaceId == null || query.isPending) {
    return <span className="text-muted-foreground">…</span>;
  }
  if (query.isError) {
    return <span className="text-muted-foreground">—</span>;
  }
  const owner = query.data;
  if (!owner) {
    return <span className="text-muted-foreground">{t("noOwner")}</span>;
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
  const t = useTranslations("adminAccess.owner");
  const tc = useTranslations("adminAccess.common");
  const queryClient = useQueryClient();
  const owner = useWorkspaceOwner(workspaceId).data;

  const mutation = useMutation({
    mutationFn: (authUserId: number | null) =>
      workspaceService.setOwner(workspaceId as number, authUserId),
    onSuccess: (next) => {
      queryClient.setQueryData(adminQueryKeys.workspaceOwner(workspaceId), next);
      notify.success(
        next
          ? t("ownerSet", {
              owner: next.username ? `@${next.username}` : `#${next.auth_user_id}`
            })
          : t("cleared")
      );
    },
    onError: (error) => notify.apiError(error, { title: t("changedError") })
  });

  if (!isSuperuser || workspaceId == null) return null;

  return (
    <div className="mt-3">
      <label htmlFor="workspace-owner" className="text-sm font-medium leading-none">
        {tc("reassignOwner")}
      </label>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <AuthUserSearchCombobox
          id="workspace-owner"
          value={owner?.auth_user_id}
          selectedLabel={owner?.username ?? owner?.email ?? undefined}
          onSelect={(account) => mutation.mutate(account?.id ?? null)}
          placeholder={tc("selectAccount")}
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
            {tc("clear")}
          </Button>
        ) : null}
      </div>
      <p className="mt-1 max-w-prose text-xs text-muted-foreground">
        {t("superuserDescription")}
      </p>
    </div>
  );
}

/**
 * Ownership hand-off — the stamp AND the `owner` role.
 *
 * Shown to the current owner as well as superusers, which is exactly the gate
 * the backend enforces: the person on the hook is the one entitled to get off
 * it, and a co-administrator with `workspace.update` is not. Picking an account
 * opens the confirmation rather than firing, because unlike the reassignment
 * above this one takes the actor's own owner role away.
 */
export function WorkspaceOwnerTransferControl({
  workspaceId,
  workspaceName,
  isSuperuser
}: Readonly<{ workspaceId: number | null; workspaceName: string; isSuperuser: boolean }>) {
  const t = useTranslations("adminAccess.owner");
  const tc = useTranslations("adminAccess.common");
  const queryClient = useQueryClient();
  const owner = useWorkspaceOwner(workspaceId).data;
  const currentUserId = useAuthProfileStore((state) => state.user?.id);
  const [target, setTarget] = useState<AuthUserOption | null>(null);

  const mutation = useMutation({
    mutationFn: (authUserId: number) =>
      workspaceService.transferOwnership(workspaceId as number, authUserId),
    onSuccess: (next) => {
      queryClient.setQueryData(adminQueryKeys.workspaceOwner(workspaceId), next);
      setTarget(null);
      notify.success(
        t("ownershipTransferred", {
          owner: next.username ? `@${next.username}` : `#${next.auth_user_id}`
        })
      );
    },
    onError: (error) => notify.apiError(error, { title: t("transferError") })
  });

  const isOwner = currentUserId != null && owner?.auth_user_id === currentUserId;
  if (workspaceId == null || !(isSuperuser || isOwner)) return null;

  return (
    <div className="mt-3">
      <label htmlFor="workspace-owner-transfer" className="text-sm font-medium leading-none">
        {tc("transferOwnership")}
      </label>
      <div className="mt-1.5">
        <AuthUserSearchCombobox
          id="workspace-owner-transfer"
          value={target?.id}
          selectedLabel={target?.label}
          onSelect={(account) => setTarget(account ?? null)}
          placeholder={tc("handOverTo")}
          disabled={mutation.isPending}
        />
      </div>
      <p className="mt-1 max-w-prose text-xs text-muted-foreground">
        {t("transferDescription")}
      </p>

      <ConfirmDialog
        open={target != null}
        onOpenChange={(next) => {
          if (!next) setTarget(null);
        }}
        pending={mutation.isPending}
        intent={{
          title: tc("transferOwnership"),
          description: t("recipientDescription", { target: target?.label ?? tc("account"), workspace: workspaceName, details: isOwner && !isSuperuser ? t("ownerKeeps") : t("outgoingKeeps") }),
          confirmLabel: tc("transferOwnership"),
          tone: "danger"
        }}
        onConfirm={() => {
          if (target) mutation.mutate(target.id);
        }}
      />
    </div>
  );
}
