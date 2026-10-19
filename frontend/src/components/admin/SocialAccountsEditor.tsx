"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Eye, EyeOff, MoreHorizontal, Plus, Star, X } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { StatusIcon } from "@/components/admin/StatusIcon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/kit/ConfirmDialog";
import { SocialIcon } from "@/components/social/SocialIcon";
import { getSocialProviderConfig, SOCIAL_PROVIDER_ORDER, socialAccountsForProvider } from "@/lib/social/providers";
import adminService from "@/services/admin.service";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import type { SocialAccount, SocialProvider, User } from "@/types/user.types";
import { adminQueryKeys } from "@/lib/admin/query-keys";

interface SocialAccountsEditorProps {
  userId: number;
  accounts: SocialAccount[];
  /** Superuser: full add/edit/delete/set-primary management. */
  canManage: boolean;
  /** Read rights: toggle per-workspace / global display visibility. */
  canSetVisibility: boolean;
  /** Current workspace for the per-workspace visibility toggle (null = none). */
  workspaceId: number | null;
  onUserUpdated: (user: User) => void;
}

// ─── Visibility toggles (global + current workspace) ─────────────────────────

interface VisibilityControlsProps {
  account: SocialAccount;
  userId: number;
  workspaceId: number | null;
  onUserUpdated: (user: User) => void;
}

function VisibilityControls({ account, userId, workspaceId, onUserUpdated }: Readonly<VisibilityControlsProps>) {
  const t = useTranslations("adminPeople.social");
  const queryClient = useQueryClient();
  const globalVisible = account.visible_global ?? true;
  const workspaceVisible = workspaceId != null && (account.visible_workspace_ids ?? []).includes(workspaceId);

  const mutation = useMutation({
    mutationFn: (vars: { workspace_id: number | null; visible: boolean }) =>
      adminService.setSocialAccountVisibility(userId, account.id, vars),
    onSuccess: (user) => {
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.users() });
      onUserUpdated(user);
    },
  });

  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-6 text-xs text-muted-foreground"
      aria-busy={mutation.isPending}
    >
      <label className="flex cursor-pointer select-none items-center gap-1.5">
        <Switch
          checked={globalVisible}
          onCheckedChange={(v) => mutation.mutate({ workspace_id: null, visible: v })}
          disabled={mutation.isPending}
          className="scale-75"
        />
        <Eye className="h-3 w-3" /> {t("profile")}
      </label>
      {workspaceId != null && (
        <label className="flex cursor-pointer select-none items-center gap-1.5">
          <Switch
            checked={workspaceVisible}
            onCheckedChange={(v) => mutation.mutate({ workspace_id: workspaceId, visible: v })}
            disabled={mutation.isPending}
            className="scale-75"
          />
          <EyeOff className="h-3 w-3" /> {t("workspace")}
        </label>
      )}
    </div>
  );
}

// ─── Single account row (view / inline edit) ─────────────────────────────────

interface AccountRowProps {
  account: SocialAccount;
  userId: number;
  canManage: boolean;
  canSetVisibility: boolean;
  workspaceId: number | null;
  onUserUpdated: (user: User) => void;
}

function AccountRow({ account, userId, canManage, canSetVisibility, workspaceId, onUserUpdated }: Readonly<AccountRowProps>) {
  const t = useTranslations("adminPeople.social");
  const tTable = useTranslations("kitTable.dataTableExtra");
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(account.username);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const config = getSocialProviderConfig(account.provider);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: adminQueryKeys.users() });

  useEffect(() => {
    if (editing) setTimeout(() => inputRef.current?.select(), 0);
  }, [editing]);

  const updateMutation = useMutation({
    mutationFn: () => adminService.updateSocialAccount(userId, account.id, { username: editValue.trim() }),
    onSuccess: (user) => {
      invalidate();
      onUserUpdated(user);
      setEditing(false);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: () => adminService.deleteSocialAccount(userId, account.id),
    onSuccess: (user) => {
      invalidate();
      onUserUpdated(user);
      setDeleteOpen(false);
    },
  });
  const primaryMutation = useMutation({
    mutationFn: () => adminService.setSocialAccountPrimary(userId, account.id),
    onSuccess: (user) => {
      invalidate();
      onUserUpdated(user);
    },
  });
  const verifyMutation = useMutation({
    mutationFn: () => adminService.verifySocialAccount(userId, account.id),
    onSuccess: (user) => {
      invalidate();
      onUserUpdated(user);
    },
    onError: (error) =>
      notify.apiError(error, { title: t("verifyFailed", { username: account.username }) }),
  });

  const handleSave = () => {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === account.username) {
      setEditing(false);
      return;
    }
    updateMutation.mutate();
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2 px-1">
        <Input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") setEditing(false);
          }}
          disabled={updateMutation.isPending}
          className="h-9 flex-1"
          autoFocus
        />
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-success hover:bg-success/10 hover:text-success"
          onClick={handleSave}
          disabled={updateMutation.isPending || !editValue.trim()}
          aria-busy={updateMutation.isPending}
          aria-label={t("save")}
          title={t("save")}
        >
          <Check className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={() => setEditing(false)}
          disabled={updateMutation.isPending}
          aria-label={t("cancel")}
          title={t("cancel")}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  const busy = verifyMutation.isPending || primaryMutation.isPending || deleteMutation.isPending;
  const canVerify = canManage && !account.is_verified && config.canBeVerified;
  const canMakePrimary = canManage && !account.is_primary;

  return (
    <>
      <div className="rounded-lg px-2 py-1.5">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
            <SocialIcon provider={account.provider} size={14} />
          </span>
          <span className="flex-1 truncate text-sm font-medium">{account.username}</span>
          {account.is_verified ? (
            <StatusIcon icon={Check} label={t("verified")} variant="success" className="size-3.5" />
          ) : null}
          {account.is_primary ? (
            <StatusIcon icon={Star} label={t("primary")} variant="warning" className="size-3.5 fill-current" />
          ) : null}
          {canManage ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                disabled={busy}
                aria-busy={busy}
                aria-label={tTable("actionsFor", { label: account.username })}
                title={tTable("actionsFor", { label: account.username })}
                className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-[color,background-color] hover:bg-accent/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <MoreHorizontal aria-hidden className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {canVerify ? (
                  <DropdownMenuItem title={t("verifyTitle")} onSelect={() => verifyMutation.mutate()}>
                    {t("verify")}
                  </DropdownMenuItem>
                ) : null}
                {canMakePrimary ? (
                  <DropdownMenuItem onSelect={() => primaryMutation.mutate()}>
                    {t("makePrimary")}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  onSelect={() => {
                    setEditValue(account.username);
                    setEditing(true);
                  }}
                >
                  {t("edit")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setDeleteOpen(true)}
                  className="text-danger focus:text-danger"
                >
                  {t("delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        {(canManage || canSetVisibility) && (
          <div className="mt-1">
            <VisibilityControls account={account} userId={userId} workspaceId={workspaceId} onUserUpdated={onUserUpdated} />
          </div>
        )}
      </div>
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={() => deleteMutation.mutate()}
        pending={deleteMutation.isPending}
        intent={{
          title: t("removeTitle", { username: account.username }),
          description: t("removeDescription", { provider: config.label, username: account.username }),
          confirmLabel: deleteMutation.isPending ? t("deleting") : t("deleteAction"),
          tone: "danger"
        }}
      />
    </>
  );
}

// ─── Add row (per provider) ──────────────────────────────────────────────────

function AddAccountRow({ provider, userId, onUserUpdated }: Readonly<{ provider: SocialProvider; userId: number; onUserUpdated: (user: User) => void }>) {
  const t = useTranslations("adminPeople.social");
  const queryClient = useQueryClient();
  const [value, setValue] = useState("");
  const config = getSocialProviderConfig(provider);

  const addMutation = useMutation({
    mutationFn: () => adminService.addSocialAccount(userId, { provider, username: value.trim() }),
    onSuccess: (user) => {
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.users() });
      onUserUpdated(user);
      setValue("");
    },
  });

  const handleAdd = () => {
    if (!value.trim() || addMutation.isPending) return;
    addMutation.mutate();
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 px-1">
        <Input
          placeholder={t("add", { label: config.placeholder })}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
          disabled={addMutation.isPending}
          className="h-9 flex-1"
        />
        <Button
          size="icon"
          variant="outline"
          className="h-9 w-9 shrink-0"
          onClick={handleAdd}
          disabled={!value.trim() || addMutation.isPending}
          aria-busy={addMutation.isPending}
          aria-label={t("add", { label: config.label })}
          title={t("add", { label: config.label })}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {addMutation.isError && addMutation.error instanceof Error && (
        <p className="px-1 text-xs text-destructive">{addMutation.error.message}</p>
      )}
    </div>
  );
}

// ─── Editor (unified provider combobox over social_accounts) ─────────────────

/** Provider-combobox editor for a player's social accounts: pick a provider to
 *  see its linked accounts. Superusers manage them; others may toggle display. */
export function SocialAccountsEditor({
  userId,
  accounts,
  canManage,
  canSetVisibility,
  workspaceId,
  onUserUpdated,
}: Readonly<SocialAccountsEditorProps>) {
  const t = useTranslations("adminPeople.social");
  const countByProvider = useMemo(() => {
    const map = {} as Record<SocialProvider, number>;
    for (const provider of SOCIAL_PROVIDER_ORDER) map[provider] = socialAccountsForProvider(accounts, provider).length;
    return map;
  }, [accounts]);

  const [provider, setProvider] = useState<SocialProvider>(() =>
    SOCIAL_PROVIDER_ORDER.reduce((best, p) => (countByProvider[p] > countByProvider[best] ? p : best), SOCIAL_PROVIDER_ORDER[0])
  );

  const items = socialAccountsForProvider(accounts, provider);
  const config = getSocialProviderConfig(provider);

  return (
    <div className="space-y-3">
      <Select value={provider} onValueChange={(v) => setProvider(v as SocialProvider)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SOCIAL_PROVIDER_ORDER.map((p) => {
            const pConfig = getSocialProviderConfig(p);
            const count = countByProvider[p];
            return (
              <SelectItem key={p} value={p}>
                <span className="flex items-center gap-2">
                  <SocialIcon provider={p} size={14} />
                  <span>{pConfig.label}</span>
                  {count > 0 && (
                    <span className="rounded bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">{count}</span>
                  )}
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      <div className={cn("space-y-1", items.length === 0 && "py-0")}>
        {items.length === 0 ? (
          <p className="py-5 text-center text-sm text-muted-foreground">{t("noIdentities", { label: config.label })}</p>
        ) : (
          items.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              userId={userId}
              canManage={canManage}
              canSetVisibility={canSetVisibility}
              workspaceId={workspaceId}
              onUserUpdated={onUserUpdated}
            />
          ))
        )}
      </div>

      {canManage && <AddAccountRow provider={provider} userId={userId} onUserUpdated={onUserUpdated} />}
    </div>
  );
}
