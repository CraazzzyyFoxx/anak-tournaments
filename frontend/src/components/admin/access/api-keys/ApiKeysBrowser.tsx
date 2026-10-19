"use client";

import { useId, useMemo, useState } from "react";
import { Check, Clipboard, KeyRound, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { DataTable } from "@/components/data-table";
import { StatTile, StatTileGrid } from "@/components/admin/StatTile";
import { ApiKeyQuotaDialog } from "@/components/admin/quota/ApiKeyQuotaDialog";
import { ConfirmDialog } from "@/components/kit/ConfirmDialog";
import { FilterBar } from "@/components/kit/FilterBar";
import { useFilters } from "@/components/kit/useFilters";
import { TONE_CLASS } from "@/components/kit/tone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  fetchAccountApiKeys,
  useRenameAccountApiKey,
  useRevokeAccountApiKey,
  type AccountApiKeyListResult,
  type AccountApiKeyStatusCounts
} from "@/hooks/useAccountApiKeys";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import type { AccountApiKey } from "@/types/auth.types";
import type { Workspace } from "@/types/workspace.types";

import { CreateApiKeyDialog } from "./CreateApiKeyDialog";
import { apiKeyFilterDefs } from "./filters";
import { getApiKeyStatus } from "./model";
import { useApiKeyColumns } from "./useApiKeyColumns";

const PAGE_SIZE = 20;

const EMPTY_COUNTS: AccountApiKeyStatusCounts = { total: 0, active: 0, expired: 0, revoked: 0 };

/**
 * Workspace API keys (T2, F15).
 *
 * Renaming is inline in the row (`InlineEditText`), revoking is the screen's
 * single `ConfirmDialog`, and creating is an `EntityFormDialog` whose scope
 * list is the shared `PermissionPicker` rather than a private implementation
 * of a checkbox tree. Quotas are the one screen-local concern that earns a
 * dialog of its own: they are a read (two budgets, live counters) and a write
 * in the same breath, which no row control can hold.
 */
export function ApiKeysBrowser({
  workspaces,
  currentWorkspaceId,
  isSuperuser
}: Readonly<{
  /** The workspaces this account may issue keys in; never empty. */
  workspaces: Workspace[];
  currentWorkspaceId: number | null;
  isSuperuser: boolean;
}>) {
  const t = useTranslations("adminAccess.common");
  const ta = useTranslations("adminAccess.apiKeysUi");

  const [createOpen, setCreateOpen] = useState(false);
  const [createRun, setCreateRun] = useState(0);
  const [oneTimeKey, setOneTimeKey] = useState<string | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<AccountApiKey | null>(null);
  const [pendingQuota, setPendingQuota] = useState<AccountApiKey | null>(null);
  const [counts, setCounts] = useState<AccountApiKeyStatusCounts>(EMPTY_COUNTS);
  const [availableScopes, setAvailableScopes] = useState<string[]>([]);
  const secretId = useId();

  const defs = useMemo(() => apiKeyFilterDefs(workspaces, t("workspace")), [workspaces, t]);
  const filters = useFilters(defs);

  // A key is always scoped to exactly one workspace, so there is no "all"
  // reading: an absent or unusable chip falls back to the workspace the shell
  // is already in, then to the first one this account administers.
  const chipWorkspaceId = Number(filters.values.workspace ?? "");
  const workspaceId =
    workspaces.find((workspace) => workspace.id === chipWorkspaceId)?.id ??
    workspaces.find((workspace) => workspace.id === currentWorkspaceId)?.id ??
    workspaces[0]?.id ??
    null;
  const workspace = workspaces.find((entry) => entry.id === workspaceId) ?? null;

  const renameMutation = useRenameAccountApiKey(workspaceId);
  const revokeMutation = useRevokeAccountApiKey(workspaceId);

  const columns = useApiKeyColumns({
    onRename: renameMutation.mutateAsync,
    onEditQuota: setPendingQuota,
    onRevoke: setPendingRevoke
  });

  return (
    <div className="space-y-4">
      <StatTileGrid>
        <StatTile
          label={t("totalKeys")}
          value={counts.total}
          detail={workspace ? ta("inWorkspace", { workspace: workspace.name }) : undefined}
          icon={KeyRound}
        />
        <StatTile label={t("active")} value={counts.active} tone="success" />
        <StatTile label={t("expired")} value={counts.expired} tone="neutral" />
        <StatTile label={t("revoked")} value={counts.revoked} tone="warning" />
      </StatTileGrid>

      {oneTimeKey ? (
        <div className={cn("rounded-xl border p-3", TONE_CLASS.success)}>
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0 flex-1">
              <Label htmlFor={secretId} className="text-sm font-medium text-foreground">
                {ta("oneTime")}
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {ta("oneTimeDescription")}
              </p>
              <Input
                id={secretId}
                readOnly
                value={oneTimeKey}
                className="mt-2 font-mono text-xs"
                onFocus={(event) => event.currentTarget.select()}
              />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <output className="text-xs text-muted-foreground">
                {copiedSecret ? (
                  <span className="inline-flex items-center gap-1">
                    <Check aria-hidden className="size-3.5" />
                    {t("copied")}
                  </span>
                ) : null}
              </output>
              <Button
                variant="outline"
                size="sm"
                aria-label={t("copyApiSecret")}
                onClick={async () => {
                  await navigator.clipboard.writeText(oneTimeKey);
                  setCopiedSecret(true);
                  notify.success(ta("copied"));
                }}
              >
                <Clipboard aria-hidden className="size-4" />
                {t("copySecret")}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={t("dismissSecret")}
                onClick={() => {
                  setOneTimeKey(null);
                  setCopiedSecret(false);
                }}
              >
                <X aria-hidden className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <DataTable<AccountApiKey>
        columns={columns}
        initialPageSize={PAGE_SIZE}
        pageSizeOptions={[10, 20, 50, 100]}
        searchPlaceholder={t("searchByName")}
        filterKey={filters.filterKey}
        getRowId={(row) => String(row.id)}
        emptyMessage={ta("noKeys")}
        toolbar={
          <FilterBar
            defs={defs}
            filters={filters}
            trailing={
              <Button
                size="sm"
                onClick={() => {
                  setCreateRun((run) => run + 1);
                  setCreateOpen(true);
                }}
              >
                <Plus aria-hidden className="size-4" />
                {t("createKey")}
              </Button>
            }
          />
        }
        renderMobileCard={(row) => (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{row.original.name}</p>
            <p className="truncate font-mono text-xs text-muted-foreground">
              owt_sk_{row.original.public_id}_…
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {ta("scopeSummary", {
                status: t(getApiKeyStatus(row.original)),
                count: row.original.scopes.length
              })}
            </p>
          </div>
        )}
        queryKey={(page, search, pageSize, sortField, sortDir) => [
          "account",
          "api-keys",
          workspaceId,
          page,
          search,
          pageSize,
          sortField,
          sortDir
        ]}
        queryFn={(page, search, pageSize, sortField, sortDir) =>
          workspaceId === null
            ? Promise.resolve({ results: [], total: 0, page: 1, per_page: pageSize })
            : fetchAccountApiKeys({
                workspaceId,
                page,
                perPage: pageSize,
                sort: sortField ?? undefined,
                order: sortDir,
                search: search || undefined
              })
        }
        onPageRowsChange={(_rows, page) => {
          // The table hands back what `queryFn` resolved; only a real listing carries the extras.
          if (!("counts" in page)) return;
          const result = page as AccountApiKeyListResult;
          setCounts(result.counts);
          // Never let a missing array reach the picker: it reads `.length`
          // first, and an undefined there took the whole admin page down.
          setAvailableScopes(result.available_scopes ?? []);
        }}
      />

      {/* Keyed by the open count: every "Create key" starts from a blank form
          and a fresh mutation, never the draft a cancelled dialog left. */}
      <CreateApiKeyDialog
        key={createRun}
        open={createOpen}
        onOpenChange={setCreateOpen}
        workspaceId={workspaceId}
        workspaceName={workspace?.name}
        isSuperuser={isSuperuser}
        availableScopes={availableScopes}
        onCreated={(secret) => {
          setOneTimeKey(secret);
          setCopiedSecret(false);
        }}
      />

      <ConfirmDialog
        open={pendingRevoke !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRevoke(null);
        }}
        pending={revokeMutation.isPending}
        intent={{
          title: ta("revokeTitle"),
          description: ta("revokeDescription", { name: pendingRevoke?.name ?? ta("thisKey") }),
          confirmLabel: t("revokeKey"),
          tone: "danger"
        }}
        onConfirm={() => {
          if (!pendingRevoke) return;
          revokeMutation.mutate(pendingRevoke.id, {
            onSuccess: () => {
              setPendingRevoke(null);
              notify.success(ta("revoked"));
            }
          });
        }}
      />

      {/* Keyed by the key's id: a fresh instance per open means the override
          draft can never carry a previous key's numbers into this one. */}
      <ApiKeyQuotaDialog
        key={pendingQuota?.id ?? "none"}
        apiKey={pendingQuota}
        workspaceId={workspaceId}
        onClose={() => setPendingQuota(null)}
      />
    </div>
  );
}
