"use client";

import { useEffect, useId, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Check, Clipboard, KeyRound, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useFormatter } from "next-intl";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { DateTimePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatTile, StatTileGrid } from "@/components/admin/StatTile";
import { EYEBROW_CLASS, TONE_CLASS, TONE_TEXT, type Tone } from "@/components/admin/tone";
import type { AdminDateFormatter } from "@/components/admin/format-time";
import {
  fetchAccountApiKeys,
  useCreateAccountApiKey,
  useRenameAccountApiKey,
  useRevokeAccountApiKey,
  type AccountApiKeyStatusCounts
} from "@/hooks/use-account-api-keys";
import { usePermissions } from "@/hooks/usePermissions";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { AccountApiKey, ApiKeyConfigPolicy, ApiKeyLimits } from "@/types/auth.types";

const PAGE_SIZE = 20;

/**
 * The catalog wildcard: `resource="*" action="*"`. It grants every permission the
 * owner holds, including ones added to the catalog later, so it is rendered apart
 * from the per-resource groups and toned as destructive.
 */
const FULL_ACCESS_SCOPE = "admin.*";

/** Scope chips rendered inline in the table before collapsing into a `+N` count. */
const SCOPE_PREVIEW_COUNT = 2;

const DEFAULT_LIMITS: ApiKeyLimits = {
  requests_per_minute: 60,
  jobs_per_day: 100,
  concurrent_jobs: 2,
  max_upload_bytes: 10 * 1024 * 1024,
  max_players: 500
};

const DEFAULT_POLICY: ApiKeyConfigPolicy = {
  allowed_keys: [
    "role_mask",
    "population_size",
    "generation_count",
    "use_captains",
    "max_result_variants"
  ],
  max_values: {
    population_size: 150,
    generation_count: 500,
    max_result_variants: 10
  }
};

const EMPTY_COUNTS: AccountApiKeyStatusCounts = { total: 0, active: 0, expired: 0, revoked: 0 };

type ApiKeyStatus = "active" | "expired" | "revoked";

const STATUS_META: Record<ApiKeyStatus, { label: string; tone: Tone }> = {
  active: { label: "Active", tone: "success" },
  expired: { label: "Expired", tone: "neutral" },
  revoked: { label: "Revoked", tone: "warning" }
};

function formatTimestamp(format: AdminDateFormatter, value: string | null | undefined): string {
  if (!value) return "Never";

  return format.dateTime(new Date(value), {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) return `${Math.round(value / (1024 * 1024))} MiB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KiB`;
  return `${value} B`;
}

function isPastTimestamp(value: string | null | undefined): boolean {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

function toIsoTimestamp(value: string): string | null {
  if (!value) return null;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

function getApiKeyStatus(apiKey: AccountApiKey): ApiKeyStatus {
  if (apiKey.revoked_at) return "revoked";
  if (isPastTimestamp(apiKey.expires_at)) return "expired";
  return "active";
}

function StatusCell({ status }: Readonly<{ status: ApiKeyStatus }>) {
  const meta = STATUS_META[status];

  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-xs font-medium", TONE_TEXT[meta.tone])}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {meta.label}
    </span>
  );
}

/**
 * Scope names bucketed by resource prefix (`team.create` → `team`), so a ~90-entry
 * catalog reads as a dozen short groups instead of one unusable column of boxes.
 * `admin.*` is excluded — it is not a member of any resource group.
 */
function groupScopes(scopes: readonly string[]): { resource: string; scopes: string[] }[] {
  const groups = new Map<string, string[]>();

  for (const scope of scopes) {
    if (scope === FULL_ACCESS_SCOPE) continue;
    const separator = scope.indexOf(".");
    const resource = separator > 0 ? scope.slice(0, separator) : scope;
    const bucket = groups.get(resource);
    if (bucket) bucket.push(scope);
    else groups.set(resource, [scope]);
  }

  return [...groups.entries()]
    .map(([resource, names]) => ({ resource, scopes: names.sort() }))
    .sort((left, right) => left.resource.localeCompare(right.resource));
}

/**
 * Granted scopes for one row. Relies on the `TooltipProvider` mounted by the admin
 * layout. A key with no scopes authenticates but fails every permission check, so
 * it is flagged in the danger tone rather than shown as an empty cell.
 */
function ScopesCell({ scopes }: Readonly<{ scopes: readonly string[] }>) {
  if (scopes.length === 0) {
    return (
      <span
        className={cn("inline-flex items-center gap-1.5 text-xs font-medium", TONE_TEXT.danger)}
      >
        <span aria-hidden className="size-1.5 rounded-full bg-current" />
        No scopes — inert
      </span>
    );
  }

  if (scopes.includes(FULL_ACCESS_SCOPE)) {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-xs",
          TONE_CLASS.danger
        )}
      >
        {FULL_ACCESS_SCOPE}
      </span>
    );
  }

  const preview = scopes.slice(0, SCOPE_PREVIEW_COUNT);
  const hidden = scopes.length - preview.length;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex max-w-56 flex-wrap items-center gap-1">
          {preview.map((scope) => (
            <span
              key={scope}
              className={cn(
                "rounded-md border px-1.5 py-0.5 font-mono text-xs",
                TONE_CLASS.neutral
              )}
            >
              {scope}
            </span>
          ))}
          {hidden > 0 ? (
            <span className="text-xs tabular-nums text-muted-foreground">+{hidden}</span>
          ) : null}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">
        <p className="font-mono text-xs leading-relaxed">{scopes.join(", ")}</p>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Scope selector for the create dialog. Driven entirely by `available` — the set the
 * server says this user may delegate — so the UI cannot offer a grant the backend
 * would silently drop. Nothing is pre-selected: an inert key is a deliberate choice,
 * never an accident of a default.
 */
function ScopePicker({
  available,
  selected,
  disabled,
  onToggle
}: Readonly<{
  available: readonly string[];
  selected: readonly string[];
  disabled: boolean;
  onToggle: (scope: string, checked: boolean) => void;
}>) {
  const fieldId = useId();

  if (available.length === 0) {
    return (
      <div className="space-y-1.5">
        <Label>Scopes</Label>
        <p className="rounded-md border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground">
          You hold no delegatable permissions in this workspace, so every key you create here would
          be inert. Ask a workspace admin to grant you the permissions first.
        </p>
      </div>
    );
  }

  const groups = groupScopes(available);
  const fullAccessOffered = available.includes(FULL_ACCESS_SCOPE);
  const fullAccessSelected = selected.includes(FULL_ACCESS_SCOPE);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label>Scopes</Label>
        <span
          className={cn(
            "text-xs tabular-nums",
            selected.length === 0 ? TONE_TEXT.warning : "text-muted-foreground"
          )}
        >
          {selected.length} selected
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Each scope is one permission the key may use, and it can never exceed your own rights in
        the workspace. Selecting nothing is allowed but creates a key that authenticates and then
        fails every request.
      </p>
      <div className="max-h-56 space-y-3 overflow-y-auto rounded-md border border-border/60 bg-muted/10 p-2">
        {fullAccessOffered ? (
          <label
            htmlFor={`${fieldId}-full`}
            className={cn(
              "flex cursor-pointer items-start gap-2 rounded-md border p-2",
              TONE_CLASS.danger
            )}
          >
            <Checkbox
              id={`${fieldId}-full`}
              className="mt-0.5"
              checked={fullAccessSelected}
              disabled={disabled}
              onCheckedChange={(checked) => onToggle(FULL_ACCESS_SCOPE, checked === true)}
            />
            <span className="min-w-0">
              <span className="block font-mono text-xs font-semibold">{FULL_ACCESS_SCOPE}</span>
              <span className="mt-0.5 block text-xs opacity-90">
                Full access, including permissions added later. Grant it only to a key you trust as
                much as your own account.
              </span>
            </span>
          </label>
        ) : null}
        {groups.map((group) => (
          <div key={group.resource} className="space-y-1">
            <p className={EYEBROW_CLASS}>{group.resource}</p>
            <div className="grid gap-x-3 gap-y-1 sm:grid-cols-2">
              {group.scopes.map((scope) => (
                <label
                  key={scope}
                  htmlFor={`${fieldId}-${scope}`}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 font-mono text-xs",
                    fullAccessSelected ? "text-muted-foreground/60" : "text-foreground"
                  )}
                >
                  <Checkbox
                    id={`${fieldId}-${scope}`}
                    checked={fullAccessSelected || selected.includes(scope)}
                    // admin.* already implies every scope, so the individual boxes
                    // would be a no-op — show them satisfied and lock them instead.
                    disabled={disabled || fullAccessSelected}
                    onCheckedChange={(checked) => onToggle(scope, checked === true)}
                  />
                  <span className="truncate">{scope}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LimitsText({ limits }: Readonly<{ limits: Partial<ApiKeyLimits> | undefined }>) {
  const merged: ApiKeyLimits = { ...DEFAULT_LIMITS, ...(limits ?? {}) };

  return (
    <span className="text-xs tabular-nums text-muted-foreground">
      {merged.requests_per_minute}/min · {merged.jobs_per_day}/day · {merged.concurrent_jobs}{" "}
      concurrent · {formatBytes(merged.max_upload_bytes)}
    </span>
  );
}

function PolicyText({ policy }: Readonly<{ policy: Partial<ApiKeyConfigPolicy> | undefined }>) {
  const merged = {
    allowed_keys: policy?.allowed_keys ?? DEFAULT_POLICY.allowed_keys,
    max_values: policy?.max_values ?? DEFAULT_POLICY.max_values
  };
  const caps = Object.entries(merged.max_values ?? {});
  const capSummary =
    caps.length > 0 ? caps.map(([field, cap]) => `${field} ≤ ${cap}`).join(", ") : "No caps";

  return (
    <div className="max-w-72 text-xs text-muted-foreground">
      <p className="truncate">Allowed: {merged.allowed_keys.join(", ") || "None"}</p>
      <p className="truncate tabular-nums">{capSummary}</p>
    </div>
  );
}

function DefaultPolicyPreview() {
  return (
    <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
      <div className="rounded-md border border-border/60 bg-muted/20 p-2">
        <p className="font-medium text-foreground">Limits</p>
        <p className="mt-1 tabular-nums">
          {DEFAULT_LIMITS.requests_per_minute}/min · {DEFAULT_LIMITS.jobs_per_day}/day ·{" "}
          {DEFAULT_LIMITS.concurrent_jobs} concurrent
        </p>
      </div>
      <div className="rounded-md border border-border/60 bg-muted/20 p-2">
        <p className="font-medium text-foreground">Policy</p>
        <p className="mt-1">Allowed keys: {DEFAULT_POLICY.allowed_keys.join(", ")}</p>
      </div>
    </div>
  );
}

export default function AccessAdminApiKeysPage() {
  const format = useFormatter();
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const currentWorkspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const fetchWorkspaces = useWorkspaceStore((state) => state.fetchWorkspaces);
  const { hasWorkspacePermission, isSuperuser, isWorkspaceAdmin } = usePermissions();
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<number | null>(currentWorkspaceId);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("Balancer API");
  const [createWorkspaceId, setCreateWorkspaceId] = useState<number | null>(currentWorkspaceId);
  const [createExpiresAt, setCreateExpiresAt] = useState("");
  const [createScopes, setCreateScopes] = useState<string[]>([]);
  const [oneTimeKey, setOneTimeKey] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<AccountApiKey | null>(null);
  const [renameName, setRenameName] = useState("");
  const [revokeTarget, setRevokeTarget] = useState<AccountApiKey | null>(null);
  const [counts, setCounts] = useState<AccountApiKeyStatusCounts>(EMPTY_COUNTS);
  const [availableScopes, setAvailableScopes] = useState<string[]>([]);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const workspaceFilterId = useId();
  const createNameId = useId();
  const createWorkspaceFieldId = useId();
  const renameNameId = useId();
  const secretId = useId();

  useEffect(() => {
    if (workspaces.length === 0) {
      void fetchWorkspaces();
    }
  }, [fetchWorkspaces, workspaces.length]);

  const manageableWorkspaces = workspaces.filter(
    (workspace) =>
      isSuperuser ||
      isWorkspaceAdmin(workspace.id) ||
      hasWorkspacePermission(workspace.id, "team.create")
  );
  const selectedWorkspaceIsManageable =
    selectedWorkspaceId !== null &&
    manageableWorkspaces.some((workspace) => workspace.id === selectedWorkspaceId);
  const currentWorkspaceIsManageable =
    currentWorkspaceId !== null &&
    manageableWorkspaces.some((workspace) => workspace.id === currentWorkspaceId);
  const createWorkspaceIsManageable =
    createWorkspaceId !== null &&
    manageableWorkspaces.some((workspace) => workspace.id === createWorkspaceId);
  const effectiveSelectedWorkspaceId = selectedWorkspaceIsManageable
    ? selectedWorkspaceId
    : currentWorkspaceIsManageable
      ? currentWorkspaceId
      : (manageableWorkspaces[0]?.id ?? null);
  const effectiveCreateWorkspaceId = createWorkspaceIsManageable
    ? createWorkspaceId
    : effectiveSelectedWorkspaceId;
  const selectedWorkspace =
    manageableWorkspaces.find((workspace) => workspace.id === effectiveSelectedWorkspaceId) ?? null;

  const createMutation = useCreateAccountApiKey();
  const renameMutation = useRenameAccountApiKey(effectiveSelectedWorkspaceId);
  const revokeMutation = useRevokeAccountApiKey(effectiveSelectedWorkspaceId);

  const openRenameDialog = (apiKey: AccountApiKey) => {
    setRenameTarget(apiKey);
    setRenameName(apiKey.name);
  };

  /**
   * Scopes are relative to one workspace, and `available_scopes` arrives with the
   * list query for the *selected* workspace. Moving the create target therefore has
   * to move the list filter too, otherwise the picker would offer the previous
   * workspace's grants; the chosen scopes are dropped for the same reason.
   */
  const changeCreateWorkspace = (workspaceId: number) => {
    setCreateWorkspaceId(workspaceId);
    setSelectedWorkspaceId(workspaceId);
    setCreateScopes([]);
  };

  const toggleCreateScope = (scope: string, checked: boolean) => {
    setCreateScopes((current) =>
      checked
        ? [...current, scope].sort()
        : current.filter((selected) => selected !== scope)
    );
  };

  const handleCreate = () => {
    if (createName.trim().length === 0) {
      notify.error("Name the key before creating it.", {
        description: 'Use something that says where it is used, such as "Balancer API".'
      });
      return;
    }
    if (effectiveCreateWorkspaceId === null) {
      notify.error("Pick a workspace for this key.", {
        description: "An API key is always scoped to exactly one workspace."
      });
      return;
    }
    if (createScopes.length === 0) {
      // Not a blocker: a scope-less key is a legitimate placeholder. It is only
      // worth saying out loud, because the key will 403 on everything.
      notify.warning("Creating a key with no scopes.", {
        description: "It will authenticate but every permission check rejects it."
      });
    }

    createMutation.mutate(
      {
        workspace_id: effectiveCreateWorkspaceId,
        expires_at: toIsoTimestamp(createExpiresAt),
        name: createName.trim(),
        scopes: createScopes
      },
      {
        onSuccess: (result) => {
          setOneTimeKey(result.key);
          setCopiedSecret(false);
          setSelectedWorkspaceId(result.api_key.workspace_id);
          setCreateWorkspaceId(result.api_key.workspace_id);
          setCreateExpiresAt("");
          setCreateName("Balancer API");
          setCreateScopes([]);
          setIsCreateOpen(false);
          notify.success("API key created", {
            description: "Copy the secret now. It will not be shown again."
          });
        }
      }
    );
  };

  const handleRename = () => {
    if (!renameTarget) return;
    if (renameName.trim().length === 0) {
      notify.error("Enter a name for this key.", {
        description: "The name is how you recognise the key in this list."
      });
      return;
    }

    renameMutation.mutate(
      { id: renameTarget.id, name: renameName.trim() },
      {
        onSuccess: () => {
          setRenameTarget(null);
          setRenameName("");
          notify.success("API key renamed");
        }
      }
    );
  };

  const handleRevoke = () => {
    if (!revokeTarget) return;

    revokeMutation.mutate(revokeTarget.id, {
      onSuccess: () => {
        setRevokeTarget(null);
        notify.success("API key revoked");
      }
    });
  };

  const copyOneTimeKey = async () => {
    if (!oneTimeKey) return;
    await navigator.clipboard.writeText(oneTimeKey);
    setCopiedSecret(true);
    notify.success("API key copied");
  };

  const columns: ColumnDef<AccountApiKey>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => {
        const apiKey = row.original;
        return (
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/20">
              <KeyRound aria-hidden className="size-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{apiKey.name}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">
                aqt_sk_{apiKey.public_id}_…
              </p>
            </div>
          </div>
        );
      }
    },
    {
      id: "status",
      header: "Status",
      enableSorting: false,
      cell: ({ row }) => <StatusCell status={getApiKeyStatus(row.original)} />
    },
    {
      id: "scopes",
      header: "Scopes",
      enableSorting: false,
      cell: ({ row }) => <ScopesCell scopes={row.original.scopes} />
    },
    {
      accessorKey: "created_at",
      header: "Created",
      cell: ({ row }) => (
        <span className="text-xs tabular-nums text-muted-foreground">
          {formatTimestamp(format, row.original.created_at)}
        </span>
      )
    },
    {
      accessorKey: "last_used_at",
      header: "Last used",
      cell: ({ row }) => (
        <span className="text-xs tabular-nums text-muted-foreground">
          {formatTimestamp(format, row.original.last_used_at)}
        </span>
      )
    },
    {
      accessorKey: "expires_at",
      header: "Expires",
      cell: ({ row }) => (
        <span className="text-xs tabular-nums text-muted-foreground">
          {formatTimestamp(format, row.original.expires_at)}
        </span>
      )
    },
    {
      id: "limits",
      header: "Limits",
      enableSorting: false,
      cell: ({ row }) => <LimitsText limits={row.original.limits} />
    },
    {
      id: "policy",
      header: "Policy",
      enableSorting: false,
      cell: ({ row }) => <PolicyText policy={row.original.config_policy} />
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const apiKey = row.original;
        if (getApiKeyStatus(apiKey) !== "active") {
          return <span className="text-xs text-muted-foreground">No actions</span>;
        }
        return (
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-md"
              aria-label={`Rename API key ${apiKey.name}`}
              disabled={renameMutation.isPending || revokeMutation.isPending}
              onClick={() => openRenameDialog(apiKey)}
            >
              <Pencil aria-hidden className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-md text-destructive hover:text-destructive"
              aria-label={`Revoke API key ${apiKey.name}`}
              disabled={revokeMutation.isPending}
              onClick={() => setRevokeTarget(apiKey)}
            >
              <Trash2 aria-hidden className="size-4" />
            </Button>
          </div>
        );
      }
    }
  ];

  if (manageableWorkspaces.length === 0) {
    return (
      <div className="space-y-4">
        <AdminPageHeader
          title="API keys"
          description="Manage workspace-scoped credentials for the balancer public API."
        />
        <div className="rounded-lg border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">
          API keys are scoped to a workspace, and you do not administer one yet. Ask a superuser for
          workspace admin rights, then reload this page.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="API keys"
        description="Manage workspace-scoped credentials for the balancer public API."
        actions={
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus aria-hidden className="size-4" />
            Create key
          </Button>
        }
      />

      <StatTileGrid>
        <StatTile
          label="Total keys"
          value={counts.total}
          detail={selectedWorkspace ? `In ${selectedWorkspace.name}` : undefined}
          icon={KeyRound}
        />
        <StatTile label="Active" value={counts.active} tone="success" />
        <StatTile label="Expired" value={counts.expired} tone="neutral" />
        <StatTile label="Revoked" value={counts.revoked} tone="warning" />
      </StatTileGrid>

      {oneTimeKey ? (
        <div className="rounded-xl border border-success/40 bg-success/10 p-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0 flex-1">
              <Label htmlFor={secretId} className="text-sm font-medium text-foreground">
                One-time secret
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                This full API key is visible only once. Copy it now — reopening this page will not
                show it again.
              </p>
              <Input
                id={secretId}
                readOnly
                value={oneTimeKey}
                className="mt-2 bg-background/80 font-mono text-xs"
                onFocus={(event) => event.currentTarget.select()}
              />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <output className="text-xs text-muted-foreground">
                {copiedSecret ? (
                  <span className="inline-flex items-center gap-1">
                    <Check aria-hidden className="size-3.5" />
                    Copied to clipboard
                  </span>
                ) : null}
              </output>
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-md"
                aria-label="Copy the API key secret to the clipboard"
                onClick={() => void copyOneTimeKey()}
              >
                <Clipboard aria-hidden className="size-4" />
                Copy secret
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 rounded-md"
                aria-label="Dismiss the one-time secret"
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

      <AdminDataTable
        initialPageSize={PAGE_SIZE}
        pageSizeOptions={[10, 20, 50, 100]}
        queryKey={(page, search, pageSize, sortField, sortDir) => [
          "account",
          "api-keys",
          effectiveSelectedWorkspaceId,
          page,
          search,
          pageSize,
          sortField,
          sortDir
        ]}
        queryFn={async (page, search, pageSize, sortField, sortDir) => {
          if (effectiveSelectedWorkspaceId === null) {
            return { results: [], total: 0, page: 1, per_page: pageSize };
          }
          const result = await fetchAccountApiKeys({
            workspaceId: effectiveSelectedWorkspaceId,
            page,
            perPage: pageSize,
            sort: sortField ?? undefined,
            order: sortDir,
            search: search || undefined
          });
          setCounts(result.counts);
          setAvailableScopes(result.available_scopes);
          return result;
        }}
        columns={columns}
        searchPlaceholder="Search by name…"
        emptyMessage="No API keys in this workspace yet. Create one to call the balancer public API."
        actions={
          <div className="flex items-center gap-2">
            <Label htmlFor={workspaceFilterId} className="text-xs text-muted-foreground">
              Workspace
            </Label>
            <Select
              value={
                effectiveSelectedWorkspaceId !== null
                  ? String(effectiveSelectedWorkspaceId)
                  : undefined
              }
              onValueChange={(value) => changeCreateWorkspace(Number(value))}
            >
              <SelectTrigger id={workspaceFilterId} className="h-9 w-56 bg-muted/20">
                <SelectValue placeholder="Select workspace" />
              </SelectTrigger>
              <SelectContent>
                {manageableWorkspaces.map((workspace) => (
                  <SelectItem key={workspace.id} value={String(workspace.id)}>
                    {workspace.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-lg rounded-xl">
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>
              The key is scoped to one workspace and carries only the permissions you grant it
              here.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor={createNameId}>Name</Label>
              <Input
                id={createNameId}
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                maxLength={100}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={createWorkspaceFieldId}>Workspace</Label>
              <Select
                value={
                  effectiveCreateWorkspaceId !== null
                    ? String(effectiveCreateWorkspaceId)
                    : undefined
                }
                onValueChange={(value) => changeCreateWorkspace(Number(value))}
              >
                <SelectTrigger id={createWorkspaceFieldId}>
                  <SelectValue placeholder="Select workspace" />
                </SelectTrigger>
                <SelectContent>
                  {manageableWorkspaces.map((workspace) => (
                    <SelectItem key={workspace.id} value={String(workspace.id)}>
                      {workspace.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <ScopePicker
              available={availableScopes}
              selected={createScopes}
              disabled={createMutation.isPending}
              onToggle={toggleCreateScope}
            />
            <DateTimePicker
              id="create-api-key-expires-date"
              timeId="create-api-key-expires-time"
              dateLabel="Expires"
              timeLabel="Time"
              value={createExpiresAt}
              onChange={setCreateExpiresAt}
              placeholder="Never"
              clearLabel="Never"
              minDate={new Date()}
              disabled={createMutation.isPending}
            />
            <DefaultPolicyPreview />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCreateOpen(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? (
                <Loader2 aria-hidden className="size-4 animate-spin" />
              ) : (
                <Plus aria-hidden className="size-4" />
              )}
              {createMutation.isPending ? "Creating…" : "Create key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRenameTarget(null);
            setRenameName("");
          }
        }}
      >
        <DialogContent className="max-w-md rounded-xl">
          <DialogHeader>
            <DialogTitle>Rename API key</DialogTitle>
            <DialogDescription>Update the display name used in this admin list.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={renameNameId}>Name</Label>
            <Input
              id={renameNameId}
              value={renameName}
              onChange={(event) => setRenameName(event.target.value)}
              maxLength={100}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRenameTarget(null);
                setRenameName("");
              }}
              disabled={renameMutation.isPending}
            >
              Cancel
            </Button>
            <Button onClick={handleRename} disabled={renameMutation.isPending}>
              {renameMutation.isPending ? (
                <Loader2 aria-hidden className="size-4 animate-spin" />
              ) : (
                <Check aria-hidden className="size-4" />
              )}
              {renameMutation.isPending ? "Saving…" : "Save name"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
      >
        <AlertDialogContent className="rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API key</AlertDialogTitle>
            <AlertDialogDescription>
              Revoking {revokeTarget?.name ?? "this key"} stops every request that uses it
              immediately, so any integration still sending it starts failing with 401. The key
              cannot be restored — issue a new one instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revokeMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={revokeMutation.isPending}
              onClick={handleRevoke}
            >
              {revokeMutation.isPending ? (
                <Loader2 aria-hidden className="size-4 animate-spin" />
              ) : (
                <Trash2 aria-hidden className="size-4" />
              )}
              {revokeMutation.isPending ? "Revoking…" : "Revoke key"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
