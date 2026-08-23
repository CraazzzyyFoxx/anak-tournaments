"use client";

import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Globe, MonitorSmartphone, Shield } from "lucide-react";
import { useFormatter } from "next-intl";

import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { TONE_TEXT, type Tone } from "@/components/admin/tone";
import type { AdminDateFormatter } from "@/components/admin/format-time";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { detectBrowser, detectPlatform } from "@/lib/user-agent";
import { rbacService } from "@/services/rbac.service";
import type { AdminAuthSession, AdminSessionStatus } from "@/types/rbac.types";

const PAGE_SIZE = 20;

const STATUS_META: Record<AdminSessionStatus, { label: string; tone: Tone }> = {
  active: { label: "Active", tone: "success" },
  revoked: { label: "Revoked", tone: "warning" },
  expired: { label: "Expired", tone: "neutral" },
};

function formatTimestamp(format: AdminDateFormatter, value: string | null | undefined): string {
  if (!value) return "Unavailable";

  return format.dateTime(new Date(value), {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatDeviceLabel(userAgent: string | null | undefined): string {
  if (!userAgent) return "Unknown device";

  const browser = detectBrowser(userAgent);
  const platform = detectPlatform(userAgent);

  if (browser && platform) return `${browser} on ${platform}`;
  if (browser) return browser;
  if (platform) return platform;

  return userAgent.length > 64 ? `${userAgent.slice(0, 64)}…` : userAgent;
}

function StatusCell({ status }: Readonly<{ status: AdminSessionStatus }>) {
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

export default function AccessAdminSessionsPage() {
  const format = useFormatter();
  const [statusFilter, setStatusFilter] = useState<"all" | AdminSessionStatus>("all");

  const columns: ColumnDef<AdminAuthSession>[] = [
    {
      id: "user",
      header: "User",
      enableSorting: false,
      accessorFn: (row) => row.email ?? row.username ?? `#${row.user_id}`,
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{row.original.email ?? "Email unavailable"}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.original.username ? `@${row.original.username}` : `User #${row.original.user_id}`}
          </p>
        </div>
      ),
    },
    {
      id: "device",
      header: "Device",
      enableSorting: false,
      accessorFn: (row) => formatDeviceLabel(row.user_agent),
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MonitorSmartphone aria-hidden className="h-4 w-4 text-muted-foreground" />
            <span className="truncate text-sm font-medium">{formatDeviceLabel(row.original.user_agent)}</span>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {row.original.user_agent ?? "User agent unavailable"}
          </p>
        </div>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <StatusCell status={row.original.status} />,
    },
    {
      accessorKey: "login_at",
      header: "Signed in",
      cell: ({ row }) => (
        <span className="text-sm tabular-nums text-muted-foreground">
          {formatTimestamp(format, row.original.login_at)}
        </span>
      ),
    },
    {
      accessorKey: "last_seen_at",
      header: "Last seen",
      cell: ({ row }) => (
        <span className="text-sm tabular-nums text-muted-foreground">
          {formatTimestamp(format, row.original.last_seen_at)}
        </span>
      ),
    },
    {
      accessorKey: "expires_at",
      header: "Expires",
      cell: ({ row }) => (
        <span className="text-sm tabular-nums text-muted-foreground">
          {formatTimestamp(format, row.original.expires_at)}
        </span>
      ),
    },
    {
      id: "network",
      header: "Network",
      enableSorting: false,
      accessorFn: (row) => row.ip_address ?? "",
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm">
            <Globe aria-hidden className="h-4 w-4 text-muted-foreground" />
            <span className="tabular-nums">{row.original.ip_address ?? "Unavailable"}</span>
          </div>
          <p className="mt-1 truncate text-xs tabular-nums text-muted-foreground">
            Session ID: {row.original.session_id}
          </p>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Auth sessions"
        description="Superuser view across all user sessions. Read-only inventory for investigation and support."
        meta={
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Shield aria-hidden className="size-3.5" />
            Superuser
          </span>
        }
      />

      <AdminDataTable
        initialPageSize={PAGE_SIZE}
        pageSizeOptions={[10, 20, 50, 100]}
        queryKey={(page, search, pageSize, sortField, sortDir) => [
          "access-admin",
          "sessions",
          page,
          search,
          pageSize,
          sortField,
          sortDir,
          statusFilter,
        ]}
        queryFn={(page, search, pageSize, sortField, sortDir) =>
          rbacService.listSessions({
            page,
            per_page: pageSize,
            sort: sortField ?? undefined,
            order: sortDir,
            search: search || undefined,
            status: statusFilter !== "all" ? statusFilter : undefined,
          })
        }
        columns={columns}
        searchPlaceholder="Search by email, username, IP, or user agent…"
        emptyMessage="No sessions match these filters. Try a different search or set the status filter to all statuses."
        actions={
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as "all" | AdminSessionStatus)}>
            <SelectTrigger className="w-44" aria-label="Filter by session status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="revoked">Revoked</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
            </SelectContent>
          </Select>
        }
      />
    </div>
  );
}
