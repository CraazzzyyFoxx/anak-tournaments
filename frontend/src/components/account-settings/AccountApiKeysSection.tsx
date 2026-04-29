"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  Clipboard,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  X,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useAccountApiKeys,
  useCreateAccountApiKey,
  useRenameAccountApiKey,
  useRevokeAccountApiKey,
} from "@/hooks/use-account-api-keys";
import { useToast } from "@/hooks/use-toast";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { AccountApiKey, ApiKeyConfigPolicy, ApiKeyLimits } from "@/types/auth.types";

const DEFAULT_LIMITS: ApiKeyLimits = {
  requests_per_minute: 60,
  jobs_per_day: 100,
  concurrent_jobs: 2,
  max_upload_bytes: 10 * 1024 * 1024,
  max_players: 500,
};

const DEFAULT_POLICY: ApiKeyConfigPolicy = {
  allowed_keys: ["algorithm", "role_mask", "population_size", "generation_count", "use_captains", "max_result_variants"],
  allowed_algorithms: ["moo"],
  max_values: {
    population_size: 150,
    generation_count: 500,
    max_result_variants: 10,
  },
};

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "Never";

  return new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) {
    return `${Math.round(value / (1024 * 1024))} MiB`;
  }
  if (value >= 1024) {
    return `${Math.round(value / 1024)} KiB`;
  }
  return `${value} B`;
}

function mergeLimits(limits: Partial<ApiKeyLimits> | undefined): ApiKeyLimits {
  return { ...DEFAULT_LIMITS, ...(limits ?? {}) };
}

function mergePolicy(policy: Partial<ApiKeyConfigPolicy> | undefined): ApiKeyConfigPolicy {
  return {
    allowed_keys: policy?.allowed_keys ?? DEFAULT_POLICY.allowed_keys,
    allowed_algorithms: policy?.allowed_algorithms ?? DEFAULT_POLICY.allowed_algorithms,
    max_values: policy?.max_values ?? DEFAULT_POLICY.max_values,
  };
}

function LimitSummary({ limits }: { limits: Partial<ApiKeyLimits> | undefined }) {
  const merged = mergeLimits(limits);
  const items = [
    ["Requests", `${merged.requests_per_minute}/min`],
    ["Jobs", `${merged.jobs_per_day}/day`],
    ["Concurrent", `${merged.concurrent_jobs}`],
    ["Upload", formatBytes(merged.max_upload_bytes)],
    ["Players", `${merged.max_players}`],
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-5">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-white/10 bg-black/10 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-1 text-sm font-semibold text-slate-100">{value}</p>
        </div>
      ))}
    </div>
  );
}

function PolicySummary({ policy }: { policy: Partial<ApiKeyConfigPolicy> | undefined }) {
  const merged = mergePolicy(policy);
  const caps = Object.entries(merged.max_values ?? {});

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-white">
        <Shield className="h-4 w-4 text-sky-200" />
        Balancer policy
      </div>
      <div className="flex flex-wrap gap-2">
        {merged.allowed_keys.map((field) => (
          <span key={field} className="rounded-full border border-white/10 bg-black/10 px-2.5 py-1 text-xs text-slate-300">
            {field}
          </span>
        ))}
      </div>
      <div className="grid gap-2 text-xs text-slate-300 sm:grid-cols-2">
        <div className="rounded-lg border border-white/10 bg-black/10 px-3 py-2">
          <p className="font-semibold uppercase tracking-wide text-slate-500">Algorithm</p>
          <p className="mt-1">{merged.allowed_algorithms.join(", ") || "None"}</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/10 px-3 py-2">
          <p className="font-semibold uppercase tracking-wide text-slate-500">Caps</p>
          <p className="mt-1">{caps.map(([field, cap]) => `${field} <= ${cap}`).join(", ") || "None"}</p>
        </div>
      </div>
    </div>
  );
}

function ApiKeyCard({
  apiKey,
  isRenaming,
  isRevoking,
  onRename,
  onRevoke,
}: {
  apiKey: AccountApiKey;
  isRenaming: boolean;
  isRevoking: boolean;
  onRename: (id: number, name: string) => void;
  onRevoke: (id: number) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(apiKey.name);

  const disabled = apiKey.revoked_at !== null && apiKey.revoked_at !== undefined;

  return (
    <div
      className="liquid-glass rounded-2xl border border-white/10 p-5"
      style={
        {
          "--lg-a": "15 23 42",
          "--lg-b": "30 41 59",
          "--lg-c": disabled ? "100 116 139" : "14 165 233",
        } as CSSProperties
      }
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-200">
                <KeyRound className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                {isEditing ? (
                  <div className="flex gap-2">
                    <Input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      className="h-8 border-white/10 bg-black/20 text-white"
                      maxLength={100}
                    />
                    <Button
                      size="icon"
                      variant="outline"
                      disabled={isRenaming || name.trim().length === 0}
                      onClick={() => {
                        onRename(apiKey.id, name);
                        setIsEditing(false);
                      }}
                      aria-label="Save API key name"
                    >
                      {isRenaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={isRenaming}
                      onClick={() => {
                        setName(apiKey.name);
                        setIsEditing(false);
                      }}
                      aria-label="Cancel rename"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <p className="truncate text-sm font-semibold text-white">{apiKey.name}</p>
                    <p className="mt-0.5 font-mono text-xs text-slate-400">aqt_sk_{apiKey.public_id}_...</p>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {disabled ? (
              <span className="rounded-full border border-slate-400/20 bg-slate-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-300">
                Revoked
              </span>
            ) : (
              <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-200">
                Active
              </span>
            )}
            {!disabled ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isRenaming || isRevoking}
                  onClick={() => {
                    setName(apiKey.name);
                    setIsEditing(true);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                  Rename
                </Button>
                <Button size="sm" variant="outline" disabled={isRevoking} onClick={() => onRevoke(apiKey.id)}>
                  {isRevoking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Revoke
                </Button>
              </>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 text-sm text-slate-300 md:grid-cols-3">
          <div className="rounded-xl border border-white/5 bg-black/10 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Created</p>
            <p className="mt-1">{formatTimestamp(apiKey.created_at)}</p>
          </div>
          <div className="rounded-xl border border-white/5 bg-black/10 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Last Used</p>
            <p className="mt-1">{formatTimestamp(apiKey.last_used_at)}</p>
          </div>
          <div className="rounded-xl border border-white/5 bg-black/10 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Expires</p>
            <p className="mt-1">{formatTimestamp(apiKey.expires_at)}</p>
          </div>
        </div>

        <LimitSummary limits={apiKey.limits} />
        <PolicySummary policy={apiKey.config_policy} />
      </div>
    </div>
  );
}

export default function AccountApiKeysSection() {
  const { toast } = useToast();
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const currentWorkspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const fetchWorkspaces = useWorkspaceStore((state) => state.fetchWorkspaces);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<number | null>(currentWorkspaceId);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("Balancer API");
  const [createWorkspaceId, setCreateWorkspaceId] = useState<number | null>(currentWorkspaceId);
  const [oneTimeKey, setOneTimeKey] = useState<string | null>(null);
  const [revokeTargetId, setRevokeTargetId] = useState<number | null>(null);

  useEffect(() => {
    if (workspaces.length === 0) {
      void fetchWorkspaces();
    }
  }, [fetchWorkspaces, workspaces.length]);

  const effectiveSelectedWorkspaceId = selectedWorkspaceId ?? currentWorkspaceId ?? workspaces[0]?.id ?? null;
  const effectiveCreateWorkspaceId = createWorkspaceId ?? currentWorkspaceId ?? workspaces[0]?.id ?? null;

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === effectiveSelectedWorkspaceId) ?? null,
    [effectiveSelectedWorkspaceId, workspaces],
  );

  const { data, isLoading, isError, error, refetch } = useAccountApiKeys(effectiveSelectedWorkspaceId);
  const createMutation = useCreateAccountApiKey();
  const renameMutation = useRenameAccountApiKey(effectiveSelectedWorkspaceId);
  const revokeMutation = useRevokeAccountApiKey(effectiveSelectedWorkspaceId);
  const apiKeys = data ?? [];
  const activeCount = apiKeys.filter((apiKey) => !apiKey.revoked_at).length;

  const handleCreate = () => {
    if (effectiveCreateWorkspaceId === null || createName.trim().length === 0) return;

    createMutation.mutate(
      { workspace_id: effectiveCreateWorkspaceId, name: createName.trim() },
      {
        onSuccess: (result) => {
          setOneTimeKey(result.key);
          setSelectedWorkspaceId(result.api_key.workspace_id);
          setCreateName("Balancer API");
          setIsCreateOpen(false);
          toast({
            title: "API key created",
            description: "Copy the secret now. It will not be shown again.",
          });
        },
        onError: (mutationError) => {
          toast({
            title: "Failed to create API key",
            description: getErrorMessage(mutationError, "Unable to create API key"),
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleRename = (id: number, name: string) => {
    renameMutation.mutate(
      { id, name: name.trim() },
      {
        onSuccess: () => {
          toast({ title: "API key renamed" });
        },
        onError: (mutationError) => {
          toast({
            title: "Failed to rename API key",
            description: getErrorMessage(mutationError, "Unable to rename API key"),
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleRevoke = () => {
    if (revokeTargetId === null) return;

    revokeMutation.mutate(revokeTargetId, {
      onSuccess: () => {
        setRevokeTargetId(null);
        toast({ title: "API key revoked" });
      },
      onError: (mutationError) => {
        toast({
          title: "Failed to revoke API key",
          description: getErrorMessage(mutationError, "Unable to revoke API key"),
          variant: "destructive",
        });
      },
    });
  };

  const copyOneTimeKey = async () => {
    if (!oneTimeKey) return;
    await navigator.clipboard.writeText(oneTimeKey);
    toast({ title: "API key copied" });
  };

  if (workspaces.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-sm text-slate-400">
        No workspaces are available for API keys.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Workspace</label>
          <Select
            value={effectiveSelectedWorkspaceId !== null ? String(effectiveSelectedWorkspaceId) : undefined}
            onValueChange={(value) => setSelectedWorkspaceId(Number(value))}
          >
            <SelectTrigger className="border-white/10 bg-black/20 text-white">
              <SelectValue placeholder="Select workspace" />
            </SelectTrigger>
            <SelectContent>
              {workspaces.map((workspace) => (
                <SelectItem key={workspace.id} value={String(workspace.id)}>
                  {workspace.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Create key
        </Button>
      </div>

      {oneTimeKey ? (
        <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-4 text-sm text-emerald-50">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="font-semibold">One-time secret</p>
              <p className="mt-1 text-emerald-100/80">This full API key is visible only once.</p>
              <code className="mt-3 block overflow-x-auto rounded-lg border border-emerald-300/20 bg-black/20 p-3 text-xs text-emerald-50">
                {oneTimeKey}
              </code>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void copyOneTimeKey()}>
                <Clipboard className="h-4 w-4" />
                Copy
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setOneTimeKey(null)} aria-label="Dismiss secret">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Workspace</p>
          <p className="mt-2 truncate text-lg font-semibold text-white">{selectedWorkspace?.name ?? "Selected"}</p>
          <p className="mt-1 truncate text-sm text-slate-400">{selectedWorkspace?.slug ?? "workspace"}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Active Keys</p>
          <p className="mt-2 text-2xl font-semibold text-white">{activeCount}</p>
          <p className="mt-1 text-sm text-slate-400">Revoked keys stay in history.</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Default Limit</p>
          <p className="mt-2 text-2xl font-semibold text-white">{DEFAULT_LIMITS.requests_per_minute}/min</p>
          <p className="mt-1 text-sm text-slate-400">Per API key.</p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4">
          {Array.from({ length: 2 }).map((_, index) => (
            <div
              key={index}
              className="liquid-glass relative h-[320px] overflow-hidden rounded-2xl"
              style={{ "--lg-a": "30 41 59", "--lg-b": "15 23 42", "--lg-c": "51 65 85" } as CSSProperties}
            >
              <Skeleton className="absolute inset-0 rounded-2xl bg-transparent" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          <p className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            {getErrorMessage(error, "Failed to load API keys")}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3 border-red-500/50 hover:bg-red-500/20 hover:text-red-100"
            onClick={() => {
              void refetch();
            }}
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </Button>
        </div>
      ) : apiKeys.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-sm text-slate-400">
          No API keys for this workspace.
        </div>
      ) : (
        <div className="grid gap-4">
          {apiKeys.map((apiKey) => (
            <ApiKeyCard
              key={apiKey.id}
              apiKey={apiKey}
              isRenaming={renameMutation.isPending && renameMutation.variables?.id === apiKey.id}
              isRevoking={revokeMutation.isPending && revokeMutation.variables === apiKey.id}
              onRename={handleRename}
              onRevoke={setRevokeTargetId}
            />
          ))}
        </div>
      )}

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent
          className="liquid-glass border-border/40 bg-card text-white shadow-2xl [&>button]:text-slate-400 [&>button]:hover:text-white"
          style={
            {
              "--lg-a": "15 23 42",
              "--lg-b": "56 189 248",
              "--lg-c": "139 92 246",
            } as CSSProperties
          }
        >
          <DialogHeader>
            <DialogTitle className="text-white">Create API key</DialogTitle>
            <DialogDescription className="text-slate-400">
              The key is scoped to one workspace and can use the balancer public API.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Name</label>
              <Input
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                maxLength={100}
                className="border-white/10 bg-black/20 text-white"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Workspace</label>
              <Select
                value={effectiveCreateWorkspaceId !== null ? String(effectiveCreateWorkspaceId) : undefined}
                onValueChange={(value) => setCreateWorkspaceId(Number(value))}
              >
                <SelectTrigger className="border-white/10 bg-black/20 text-white">
                  <SelectValue placeholder="Select workspace" />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((workspace) => (
                    <SelectItem key={workspace.id} value={String(workspace.id)}>
                      {workspace.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <LimitSummary limits={DEFAULT_LIMITS} />
            <PolicySummary policy={DEFAULT_POLICY} />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
              onClick={() => setIsCreateOpen(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              className="bg-white text-slate-950 hover:bg-slate-200"
              onClick={handleCreate}
              disabled={createMutation.isPending || effectiveCreateWorkspaceId === null || createName.trim().length === 0}
            >
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={revokeTargetId !== null} onOpenChange={(open) => !open && setRevokeTargetId(null)}>
        <AlertDialogContent
          className="liquid-glass border-border/40 bg-card text-white shadow-2xl"
          style={
            {
              "--lg-a": "15 23 42",
              "--lg-b": "56 189 248",
              "--lg-c": "139 92 246",
            } as CSSProperties
          }
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Revoke API key?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              Existing requests with this key will stop validating. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
              disabled={revokeMutation.isPending}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500/90 text-white hover:bg-red-500"
              disabled={revokeMutation.isPending}
              onClick={handleRevoke}
            >
              {revokeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
