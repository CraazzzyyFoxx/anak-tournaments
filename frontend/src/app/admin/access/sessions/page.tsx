"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Globe, MonitorSmartphone, UserCog } from "lucide-react";
import { useFormatter } from "@/lib/datetime/client";

import { DataTable, createKebabColumn } from "@/components/data-table";
import { FilterBar } from "@/components/kit/FilterBar";
import { Inspector } from "@/components/kit/Inspector";
import { useFilters, type FilterDef } from "@/components/kit/useFilters";
import { EYEBROW_CLASS, TONE_TEXT, type Tone } from "@/components/kit/tone";
import type { DateFormatter } from "@/components/kit/format-time";
import { StatusDot } from "@/components/ui/status-dot";
import { useQueryParams } from "@/hooks/useQueryParams";
import { cn } from "@/lib/utils";
import { detectBrowser, detectPlatform } from "@/lib/user-agent";
import { rbacService } from "@/services/rbac.service";
import type { AdminAuthSession, AdminSessionStatus } from "@/types/rbac.types";
import { useTranslations } from "next-intl";

const PAGE_SIZE = 20;

const STATUS_META: Record<AdminSessionStatus, { tone: Tone }> = {
  active: { tone: "success" }, revoked: { tone: "warning" }, expired: { tone: "neutral" }
};

function formatTimestamp(format: DateFormatter, value: string | null | undefined, unavailable: string): string {
  if (!value) return unavailable;

  return format.dateTime(new Date(value), { dateStyle: "medium", timeStyle: "short" });
}

function formatDeviceLabel(
  userAgent: string | null | undefined,
  unknownDevice: string
): string {
  if (!userAgent) return unknownDevice;

  const browser = detectBrowser(userAgent);
  const platform = detectPlatform(userAgent);

  if (browser && platform) return `${browser} on ${platform}`;
  if (browser) return browser;
  if (platform) return platform;

  return userAgent.length > 64 ? `${userAgent.slice(0, 64)}…` : userAgent;
}

function accountsHref(session: AdminAuthSession): string {
  return `/admin/access/accounts?search=${encodeURIComponent(session.email ?? session.username ?? "")}`;
}

function StatusCell({ status }: Readonly<{ status: AdminSessionStatus }>) {
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

function Field({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div className="min-w-0">
      <p className={EYEBROW_CLASS}>{label}</p>
      <div className="mt-0.5 break-words text-sm">{children}</div>
    </div>
  );
}

/**
 * Auth sessions (T2, F15) — the superuser's read-only view of who is signed in
 * where.
 *
 * The status `<Select>` is now a URL chip, and the raw user agent and the
 * network address live in the inspector: they are what an investigation needs
 * and what made every row three lines tall. The session id stays in the row,
 * truncated, because it is how a session is named in a report.
 */
export default function AccessAdminSessionsPage() {
  const t = useTranslations("adminAccess.common");
  const ts = useTranslations("adminAccess.sessionsUi");
  const format = useFormatter();
  const { searchParams, setParams } = useQueryParams({ resetOnChange: [], shallow: true });
  const openId = searchParams?.get("id") ?? null;

  const [pageRows, setPageRows] = useState<AdminAuthSession[]>([]);

  const defs = useMemo<FilterDef[]>(
    () => [
      {
        key: "status",
        label: t("status"),
        kind: "single",
        options: (Object.keys(STATUS_META) as AdminSessionStatus[]).map((status) => ({
          value: status,
          label: t(status)
        }))
      }
    ],
    [t]
  );
  const filters = useFilters(defs);
  const statusFilter = String(filters.values.status ?? "");

  const openRow = pageRows.find((row) => row.session_id === openId) ?? null;
  const openIndex = openRow ? pageRows.indexOf(openRow) : -1;

  const columns = useMemo<ColumnDef<AdminAuthSession>[]>(
    () => [
      {
        accessorKey: "session_id",
        header: "ID",
        size: 140,
        enableSorting: false,
        cell: ({ row }) => (
          <span className="block truncate font-mono text-xs" title={row.original.session_id}>
            {row.original.session_id}
          </span>
        )
      },
      {
        id: "user",
        header: t("account"),
        enableSorting: false,
        accessorFn: (row) => row.email ?? row.username ?? `#${row.user_id}`,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {row.original.email ?? t("emailUnavailable")}
            </p>
            <p className="truncate font-mono text-xs text-muted-foreground">
              {row.original.username
                ? `@${row.original.username}`
                : `account #${row.original.user_id}`}
            </p>
          </div>
        )
      },
      {
        id: "device",
        header: t("device"),
        enableSorting: false,
        accessorFn: (row) => formatDeviceLabel(row.user_agent, t("unknownDevice")),
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-2">
            <MonitorSmartphone aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm">
              {formatDeviceLabel(row.original.user_agent, t("unknownDevice"))}
            </span>
          </span>
        )
      },
      {
        accessorKey: "status",
        header: t("status"),
        cell: ({ row }) => <StatusCell status={row.original.status} />
      },
      {
        accessorKey: "login_at",
        header: t("signedIn"),
        cell: ({ row }) => (
          <span className="text-sm tabular-nums text-muted-foreground">
            {formatTimestamp(format, row.original.login_at, t("unavailable"))}
          </span>
        )
      },
      {
        accessorKey: "last_seen_at",
        header: t("lastSeen"),
        cell: ({ row }) => (
          <span className="text-sm tabular-nums text-muted-foreground">
            {formatTimestamp(format, row.original.last_seen_at, t("unavailable"))}
          </span>
        )
      },
      createKebabColumn<AdminAuthSession>(
        (row) => [{ label: t("openAuthAccount"), icon: UserCog, href: accountsHref(row) }],
        { rowLabel: (row) => `session of ${row.email ?? row.username ?? `#${row.user_id}`}` }
      )
    ],
    [format, t]
  );

  return (
    <div className={cn("grid items-start gap-4", openRow && "lg:grid-cols-[minmax(0,1fr)_380px]")}>
      <div className="min-w-0">
        <DataTable<AdminAuthSession>
          columns={columns}
          initialPageSize={PAGE_SIZE}
          pageSizeOptions={[10, 20, 50, 100]}
          searchPlaceholder={ts("search")}
          filterKey={filters.filterKey}
          inspectorId={openId}
          getRowId={(row) => row.session_id}
          toolbar={<FilterBar defs={defs} filters={filters} />}
          emptyMessage={ts("noMatches")}
          onRowClick={(row) => setParams({ id: row.original.session_id })}
          renderMobileCard={(row) => (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {row.original.email ?? `account #${row.original.user_id}`}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {formatDeviceLabel(row.original.user_agent, t("unknownDevice"))}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {ts.rich("statusSummary", {
                  status: t(row.original.status),
                  time: formatTimestamp(format, row.original.last_seen_at, t("unavailable")),
                  num: (chunks) => <span className="tabular-nums">{chunks}</span>
                })}
              </p>
            </div>
          )}
          queryKey={(page, search, pageSize, sortField, sortDir) => [
            "access-admin",
            "sessions",
            page,
            search,
            pageSize,
            sortField,
            sortDir,
            statusFilter
          ]}
          queryFn={(page, search, pageSize, sortField, sortDir) =>
            rbacService.listSessions({
              page,
              per_page: pageSize,
              sort: sortField ?? undefined,
              order: sortDir,
              search: search || undefined,
              status: (statusFilter || undefined) as AdminSessionStatus | undefined
            })
          }
          onPageRowsChange={setPageRows}
        />
      </div>

      <Inspector
        openId={openRow ? openId : null}
        onClose={() => setParams({ id: null })}
        title={openRow ? (openRow.email ?? `Account #${openRow.user_id}`) : ""}
        subtitle={openRow ? formatDeviceLabel(openRow.user_agent, t("unknownDevice")) : undefined}
        openHref={openRow ? accountsHref(openRow) : undefined}
        onPrev={
          openIndex > 0
            ? () => setParams({ id: pageRows[openIndex - 1].session_id })
            : undefined
        }
        onNext={
          openIndex >= 0 && openIndex < pageRows.length - 1
            ? () => setParams({ id: pageRows[openIndex + 1].session_id })
            : undefined
        }
      >
        {openRow ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("status")}>
                <StatusCell status={openRow.status} />
              </Field>
              <Field label={ts("network")}>
                <span className="flex items-center gap-1.5">
                  <Globe aria-hidden className="size-3.5 text-muted-foreground" />
                  <span className="tabular-nums">{openRow.ip_address ?? t("unavailable")}</span>
                </span>
              </Field>
              <Field label={t("signedIn")}>
                <span className="tabular-nums">{formatTimestamp(format, openRow.login_at, t("unavailable"))}</span>
              </Field>
              <Field label={t("lastSeen")}>
                <span className="tabular-nums">
                  {formatTimestamp(format, openRow.last_seen_at, t("unavailable"))}
                </span>
              </Field>
              <Field label={t("expires")}>
                <span className="tabular-nums">{formatTimestamp(format, openRow.expires_at, t("unavailable"))}</span>
              </Field>
              <Field label={t("revoked")}>
                <span className="tabular-nums">
                  {openRow.revoked_at ? formatTimestamp(format, openRow.revoked_at, t("unavailable")) : ts("notRevoked")}
                </span>
              </Field>
            </div>
            <Field label={ts("sessionId")}>
              <span className="font-mono text-xs tabular-nums">{openRow.session_id}</span>
            </Field>
            <Field label={ts("userAgent")}>
              <span className="font-mono text-xs">
                {openRow.user_agent ?? t("userAgentUnavailable")}
              </span>
            </Field>
          </div>
        ) : null}
      </Inspector>
    </div>
  );
}
