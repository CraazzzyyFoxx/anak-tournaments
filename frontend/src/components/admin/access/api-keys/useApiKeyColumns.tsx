"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Gauge, KeyRound, ShieldAlert, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { columnMeta, createKebabColumn } from "@/components/data-table";
import { StatusIcon } from "@/components/admin/StatusIcon";
import { InlineEditText } from "@/components/kit/InlineEditText";
import { TONE_CLASS, TONE_TEXT } from "@/components/kit/tone";
import { StatusDot } from "@/components/ui/status-dot";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useFormatter } from "@/lib/datetime/client";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import type { AccountApiKey } from "@/types/auth.types";

import {
  FULL_ACCESS_SCOPE,
  STATUS_META,
  formatTimestamp,
  getApiKeyStatus,
  type ApiKeyStatus
} from "./model";

/** Scope chips rendered inline in the table before collapsing into a `+N` count. */
const SCOPE_PREVIEW_COUNT = 2;

function StatusCell({ status }: Readonly<{ status: ApiKeyStatus }>) {
  const t = useTranslations("adminAccess.common");
  const meta = STATUS_META[status];

  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-xs font-medium", TONE_TEXT[meta.tone])}
    >
      <StatusDot />
      {t(status)}
    </span>
  );
}

/**
 * Granted scopes for one row. Relies on the `TooltipProvider` mounted by the
 * admin layout. A key with no scopes authenticates but fails every permission
 * check, so it is flagged in the danger tone rather than shown as empty.
 */
function ScopesCell({ scopes }: Readonly<{ scopes: readonly string[] }>) {
  const t = useTranslations("adminAccess.apiKeysUi");
  if (scopes.length === 0) {
    return (
      <span
        className={cn("inline-flex items-center gap-1.5 text-xs font-medium", TONE_TEXT.danger)}
      >
        <StatusDot />
        {t("noScopes")}
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
 * `onRename` is the rename mutation's `mutateAsync`, so the inline editor can
 * keep its draft when the write fails. `onEditQuota` and `onRevoke` open the
 * browser's dialogs; all three keep a stable identity, so the columns are
 * rebuilt only when the locale or the formatter changes.
 */
export function useApiKeyColumns({
  onRename,
  onEditQuota,
  onRevoke
}: Readonly<{
  onRename: (input: { id: number; name: string }, options: { onSuccess: () => void }) => Promise<unknown>;
  onEditQuota: (apiKey: AccountApiKey) => void;
  onRevoke: (apiKey: AccountApiKey) => void;
}>) {
  const t = useTranslations("adminAccess.common");
  const ta = useTranslations("adminAccess.apiKeysUi");
  const tQuota = useTranslations("quota");
  const format = useFormatter();

  return useMemo<ColumnDef<AccountApiKey>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("name"),
        cell: ({ row }) => {
          const apiKey = row.original;
          return (
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/60">
                <KeyRound aria-hidden className="size-4 text-muted-foreground" />
              </span>
              <div className="min-w-0">
                <InlineEditText
                  value={apiKey.name}
                  label={ta("nameLabel", { name: apiKey.name })}
                  canEdit={getApiKeyStatus(apiKey) === "active"}
                  textClassName="text-sm font-medium"
                  onSave={(next) =>
                    onRename(
                      { id: apiKey.id, name: next },
                      { onSuccess: () => notify.success(ta("renamed")) }
                    )
                  }
                />
                <p className="flex items-center gap-1.5 truncate font-mono text-xs text-muted-foreground">
                  owt_sk_{apiKey.public_id}_…
                  {apiKey.is_superuser ? (
                    <StatusIcon icon={ShieldAlert} label={t("superuser")} variant="destructive" />
                  ) : null}
                </p>
              </div>
            </div>
          );
        }
      },
      {
        id: "owner",
        header: t("owner"),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="truncate text-sm">{row.original.owner_username}</span>
        )
      },
      {
        id: "status",
        header: t("status"),
        enableSorting: false,
        meta: columnMeta<AccountApiKey>({ align: "center" }),
        cell: ({ row }) => <StatusCell status={getApiKeyStatus(row.original)} />
      },
      {
        id: "scopes",
        header: t("scopes"),
        enableSorting: false,
        meta: columnMeta<AccountApiKey>({ align: "center" }),
        cell: ({ row }) => <ScopesCell scopes={row.original.scopes} />
      },
      {
        accessorKey: "created_at",
        header: t("created"),
        cell: ({ row }) => (
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatTimestamp(format, row.original.created_at, t("never"))}
          </span>
        )
      },
      {
        accessorKey: "last_used_at",
        header: t("lastUsed"),
        cell: ({ row }) => (
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatTimestamp(format, row.original.last_used_at, t("never"))}
          </span>
        )
      },
      {
        accessorKey: "expires_at",
        header: t("expires"),
        cell: ({ row }) => (
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatTimestamp(format, row.original.expires_at, t("never"))}
          </span>
        )
      },
      createKebabColumn<AccountApiKey>(
        (row) => [
          {
            label: tQuota("apiKey.menuItem"),
            icon: Gauge,
            onSelect: () => onEditQuota(row)
          },
          {
            label: t("revokeKey"),
            icon: Trash2,
            destructive: true,
            hidden: getApiKeyStatus(row) !== "active",
            onSelect: () => onRevoke(row)
          }
        ],
        { rowLabel: (row) => `API key ${row.name}` }
      )
    ],
    [format, onEditQuota, onRename, onRevoke, tQuota, t, ta]
  );
}
