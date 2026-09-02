"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef, Row } from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  Check,
  Clock,
  FileCog,
  Loader2,
  MoreHorizontal,
  Sheet,
  Sparkles,
  Upload,
  UserPlus
} from "lucide-react";

import UnifiedRegistrationForm from "@/components/registration/UnifiedRegistrationForm";
import RegistrationRowActions from "@/components/balancer/registrations/_components/RegistrationRowActions";
import RankHistory from "@/components/RankHistory";
import { buildBalancerRegistrationColumns } from "@/components/balancer/registrations/_components/balancerRegistrationColumns";
import {
  type RegistrationGroupingMode,
  groupRegistrations,
  normalizeRegistrationGroupingMode
} from "@/components/balancer/registrations/_components/registrationGrouping";
import { AdminDataTable, type AdminDataTableGroup } from "@/components/admin/AdminDataTable";
import { adminColumnMeta } from "@/components/admin/admin-table-columns";
import type { AdminTableFilters } from "@/components/admin/admin-table-filters";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { mergeStatusOptions } from "@/lib/balancer-statuses";
import { notify } from "@/lib/notify";
import { formatAdmissionReason, tallyAdmissionReasons } from "@/lib/admission";
import { ROLE_LABELS, getSubroleLabel } from "@/lib/roles";
import balancerAdminService from "@/services/balancer-admin.service";
import registrationService from "@/services/registration.service";
import type {
  AdminRegistration,
  AdminRegistrationCreateInput,
  AdminRegistrationUpdateInput
} from "@/types/balancer-admin.types";
import type { RegistrationForm, SubroleCatalog } from "@/types/registration.types";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace.store";

// Minimal fallback used only until the real registration form (with its
// workspace sub-role catalog) loads. Sub-role options are then data-driven.
const ADMIN_ROLE_FORM: RegistrationForm = {
  id: 0,
  tournament_id: 0,
  workspace_id: 0,
  is_open: true,
  built_in_fields: {
    primary_role: { enabled: true, required: true },
    additional_roles: { enabled: true, required: false }
  },
  custom_fields: []
};

function formatSubmittedAt(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function RolesCell({
  roles,
  catalog
}: Readonly<{
  roles: AdminRegistration["roles"];
  catalog?: SubroleCatalog;
}>) {
  if (roles.length === 0) {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {roles
        .slice()
        .sort((left, right) => left.priority - right.priority)
        .map((role) => {
          const roleLabel = ROLE_LABELS[role.role] ?? role.role;
          const subroleLabel = role.subrole
            ? getSubroleLabel(catalog, role.role, role.subrole)
            : null;
          return (
            <div
              key={`${role.role}-${role.priority}`}
              className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs"
              title={[
                roleLabel,
                subroleLabel,
                role.rank_value != null ? `${role.rank_value}` : null
              ]
                .filter(Boolean)
                .join(" · ")}
            >
              <span>{roleLabel}</span>
              {subroleLabel ? <span className="text-muted-foreground">{subroleLabel}</span> : null}
              {role.rank_value != null ? (
                <span className="text-muted-foreground">{role.rank_value}</span>
              ) : null}
            </div>
          );
        })}
    </div>
  );
}

export default function RegistrationsTable({
  tournamentId,
  basePath
}: Readonly<{
  tournamentId: number | null;
  basePath: string;
}>) {
  const queryClient = useQueryClient();
  // The only translated strings on this screen: reason codes are shared with the
  // public participants page, so they live in the message catalogue rather than
  // as English literals like the rest of this admin table.
  const t = useTranslations();
  const searchParams = useSearchParams();
  // D25: status/sub-role catalogs are read from the workspace store. In the hub
  // the store is already aligned to the tournament's workspace by
  // useSyncActiveWorkspace, so no extra wiring is needed here.
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);

  // Header filters live in the table, which owns their URL params. They are
  // controlled here only because the "N pending" chip sets one from outside the
  // header.
  const [filters, setFilters] = useState<AdminTableFilters>({});
  const [groupBy, setGroupBy] = useState<RegistrationGroupingMode>(
    normalizeRegistrationGroupingMode(searchParams.get("group"))
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [editingRegistration, setEditingRegistration] = useState<AdminRegistration | null>(null);

  // The whole pool in one request: a tournament's registrations are a few
  // hundred rows at most, and filtering them locally keeps the pending count
  // honest — it used to be computed over an already status-filtered list, so
  // filtering to "approved" reported zero pending.
  const registrationsQuery = useQuery({
    queryKey: ["balancer-admin", "registrations", tournamentId],
    queryFn: () =>
      balancerAdminService.listRegistrations(tournamentId as number, {
        include_deleted: false
      }),
    enabled: tournamentId !== null
  });

  const formQuery = useQuery({
    queryKey: ["balancer-admin", "registration-form", tournamentId],
    queryFn: () => balancerAdminService.getRegistrationForm(tournamentId as number),
    enabled: tournamentId !== null
  });

  const publicFormQuery = useQuery({
    queryKey: ["registration-form-public", tournamentId],
    queryFn: () => registrationService.getForm(tournamentId as number),
    enabled: tournamentId !== null
  });

  // Adapt the admin form into the public RegistrationForm shape used by the
  // shared RoleStep / sub-role catalog, so admin role editing is data-driven.
  const roleForm: RegistrationForm = publicFormQuery.data ?? ADMIN_ROLE_FORM;
  const subroleCatalog = roleForm.subrole_catalog;

  // `require_open_profile` is deliberately NOT read here any more: admission is
  // resolved server-side and travels on each row. This flag survives only
  // because the Subscription chip column exists or does not exist per tournament.
  const requireSubscription = formQuery.data?.require_subscription ?? false;
  const customFields = roleForm.custom_fields;

  const customStatusesQuery = useQuery({
    queryKey: ["balancer-admin", "status-catalog", workspaceId],
    queryFn: () => balancerAdminService.listStatusCatalog(workspaceId as number),
    enabled: workspaceId !== null
  });
  const registrationStatusOptions = useMemo(
    () => mergeStatusOptions("registration", customStatusesQuery.data),
    [customStatusesQuery.data]
  );
  const statusFilterOptions = useMemo(
    () =>
      [...registrationStatusOptions.system, ...registrationStatusOptions.custom].map((option) => ({
        value: option.value,
        label: option.name
      })),
    [registrationStatusOptions]
  );

  // Patch a single row across every cached filter variant. The PATCH endpoints
  // already return the fully-serialized registration, so we never need to
  // re-fetch the whole pool just to reflect one edit.
  const patchRegistrationInCache = (row: AdminRegistration) => {
    queryClient.setQueriesData<AdminRegistration[]>(
      { queryKey: ["balancer-admin", "registrations", tournamentId] },
      (old) => (old ? old.map((r) => (r.id === row.id ? row : r)) : old)
    );
  };

  const removeRegistrationFromCache = (registrationId: number) => {
    queryClient.setQueriesData<AdminRegistration[]>(
      { queryKey: ["balancer-admin", "registrations", tournamentId] },
      (old) => (old ? old.filter((r) => r.id !== registrationId) : old)
    );
  };

  // Fire-and-forget reconcile. NOT awaited, so the spinner/modal closes
  // immediately after the mutation itself resolves.
  const revalidateRegistrations = () => {
    void queryClient.invalidateQueries({
      queryKey: ["balancer-admin", "registrations", tournamentId]
    });
  };

  const createMutation = useMutation({
    mutationFn: (payload: AdminRegistrationCreateInput) =>
      balancerAdminService.createManualRegistration(tournamentId as number, payload),
    onSuccess: () => {
      setCreateOpen(false);
      notify.success("Manual registration created");
      revalidateRegistrations();
    }
  });

  const updateMutation = useMutation({
    mutationFn: (payload: AdminRegistrationUpdateInput) => {
      if (!editingRegistration) {
        throw new Error("No registration selected");
      }
      return balancerAdminService.updateRegistration(editingRegistration.id, payload);
    },
    onSuccess: (updated) => {
      patchRegistrationInCache(updated);
      setEditingRegistration(null);
      notify.success("Registration updated");
      revalidateRegistrations();
    }
  });

  const approveMutation = useMutation({
    mutationFn: (registrationId: number) =>
      balancerAdminService.approveRegistration(registrationId),
    onSuccess: (updated) => {
      patchRegistrationInCache(updated);
      notify.success("Registration approved");
      revalidateRegistrations();
    }
  });

  const rejectMutation = useMutation({
    mutationFn: (registrationId: number) => balancerAdminService.rejectRegistration(registrationId),
    onSuccess: (updated) => {
      patchRegistrationInCache(updated);
      notify.success("Registration rejected");
      revalidateRegistrations();
    }
  });

  const withdrawMutation = useMutation({
    mutationFn: (registrationId: number) =>
      balancerAdminService.withdrawRegistration(registrationId),
    onSuccess: (updated) => {
      patchRegistrationInCache(updated);
      notify.success("Registration withdrawn");
      revalidateRegistrations();
    }
  });

  const restoreMutation = useMutation({
    mutationFn: (registrationId: number) =>
      balancerAdminService.restoreRegistration(registrationId),
    onSuccess: (updated) => {
      patchRegistrationInCache(updated);
      notify.success("Registration restored");
      revalidateRegistrations();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (registrationId: number) => balancerAdminService.deleteRegistration(registrationId),
    onSuccess: (_, registrationId) => {
      removeRegistrationFromCache(registrationId);
      notify.success("Registration deleted");
      revalidateRegistrations();
    }
  });

  const bulkApproveMutation = useMutation({
    mutationFn: (registrationIds: number[]) =>
      balancerAdminService.bulkApproveRegistrations(tournamentId as number, registrationIds),
    onSuccess: (result) => {
      notify.success(`${result.approved} approved, ${result.skipped} skipped`);
      revalidateRegistrations();
    }
  });

  const balancerInclusionMutation = useMutation({
    mutationFn: ({ registrationId, include }: { registrationId: number; include: boolean }) =>
      include
        ? balancerAdminService.includeInBalancer(registrationId)
        : balancerAdminService.setBalancerStatus(registrationId, "excluded", "manual_exclusion"),
    onSuccess: (updated) => {
      patchRegistrationInCache(updated);
      notify.success("Balancer status updated");
      revalidateRegistrations();
    }
  });

  const checkInMutation = useMutation({
    mutationFn: ({ registrationId, checkedIn }: { registrationId: number; checkedIn: boolean }) =>
      balancerAdminService.checkInRegistration(registrationId, checkedIn),
    onSuccess: (updated, variables) => {
      patchRegistrationInCache(updated);
      notify.success(variables.checkedIn ? "Checked in" : "Check-in removed");
      revalidateRegistrations();
    }
  });

  const bulkAddToBalancerMutation = useMutation({
    mutationFn: (registrationIds: number[]) =>
      balancerAdminService.bulkAddToBalancer(tournamentId as number, registrationIds),
    onSuccess: (result) => {
      notify.success(`${result.updated} added to balancer, ${result.skipped} skipped`);
      revalidateRegistrations();
    }
  });

  const exportToUsersMutation = useMutation({
    mutationFn: () => balancerAdminService.exportRegistrationsToUsers(tournamentId as number),
    onSuccess: (result) => {
      notify.success("Export complete", {
        description: `${result.processed} processed, ${result.skipped} skipped (${result.total} total)`
      });
    }
  });

  const registrations = registrationsQuery.data ?? [];
  const pendingCount = registrations.filter(
    (registration) => registration.status === "pending"
  ).length;
  const isPendingFilterOn = filters.status?.includes("pending") ?? false;
  // Over the WHOLE pool, not the current page or filter: the point of the line
  // is to answer "is this forty players to chase or one thing to fix", and a
  // tally that moved with the header filters could not.
  const reasonTally = useMemo(
    () => tallyAdmissionReasons(registrations.map((registration) => registration.admission)),
    [registrations]
  );

  // `mutate` is observer-bound and stable across renders; the mutation objects
  // around it are not, so the column memo depends on these rather than on them.
  const approve = approveMutation.mutate;
  const reject = rejectMutation.mutate;
  const withdraw = withdrawMutation.mutate;
  const restore = restoreMutation.mutate;
  const remove = deleteMutation.mutate;
  const setBalancerInclusion = balancerInclusionMutation.mutate;
  const setCheckIn = checkInMutation.mutate;

  const columns: ColumnDef<AdminRegistration>[] = useMemo(
    () => [
      ...buildBalancerRegistrationColumns(
        subroleCatalog,
        requireSubscription,
        customFields,
        statusFilterOptions
      ),
      {
        id: "actions",
        header: "Actions",
        enableSorting: false,
        size: 112,
        meta: adminColumnMeta<AdminRegistration>({ align: "right" }),
        cell: ({ row }) => (
          <RegistrationRowActions
            registration={row.original}
            onEdit={(selectedRegistration) => setEditingRegistration(selectedRegistration)}
            onApprove={approve}
            onReject={reject}
            onToggleBalancer={(selectedRegistration) =>
              setBalancerInclusion({
                registrationId: selectedRegistration.id,
                include: selectedRegistration.balancer_status_meta.excludes_from_balancer
              })
            }
            onToggleCheckIn={(selectedRegistration) =>
              setCheckIn({
                registrationId: selectedRegistration.id,
                checkedIn: !selectedRegistration.checked_in
              })
            }
            onWithdraw={withdraw}
            onRestore={restore}
            onDelete={remove}
          />
        )
      }
    ],
    [
      subroleCatalog,
      requireSubscription,
      customFields,
      statusFilterOptions,
      approve,
      reject,
      withdraw,
      restore,
      remove,
      setBalancerInclusion,
      setCheckIn
    ]
  );

  const groupPageRows = (
    pageRows: Row<AdminRegistration>[]
  ): AdminDataTableGroup<AdminRegistration>[] => {
    const rowsById = new Map(pageRows.map((row) => [row.original.id, row]));
    return groupRegistrations(
      pageRows.map((row) => row.original),
      groupBy
    ).map((group) => ({
      key: group.key,
      label: (
        <>
          <span className="text-foreground">{group.label}</span>
          <span className="ml-2 font-normal normal-case text-muted-foreground">
            {group.registrations.length}{" "}
            {group.registrations.length === 1 ? "registration" : "registrations"}
          </span>
        </>
      ),
      rows: group.registrations.flatMap((registration) => {
        const row = rowsById.get(registration.id);
        return row ? [row] : [];
      })
    }));
  };

  const renderRegistrationDetails = (row: Row<AdminRegistration>) => {
    const registration = row.original;
    return (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Rank history
          </div>
          {registration.user_id != null ? (
            <RankHistory userId={registration.user_id} />
          ) : (
            <RankHistory battleTag={registration.battle_tag} />
          )}
        </div>
        <dl className="space-y-2 text-xs text-muted-foreground">
          <div className="text-[11px] font-semibold uppercase tracking-wider">Details</div>
          <div>
            <dt className="mb-1">Declared roles</dt>
            <dd>
              <RolesCell roles={registration.roles} catalog={subroleCatalog} />
            </dd>
          </div>
          {(registration.smurf_tags_json?.length ?? 0) > 0 ? (
            <div className="flex justify-between gap-3">
              <dt>Smurfs</dt>
              <dd className="text-right">{registration.smurf_tags_json?.join(", ")}</dd>
            </div>
          ) : null}
          {registration.discord_nick || registration.twitch_nick || registration.boosty_nick ? (
            <div className="flex justify-between gap-3">
              <dt>Contact</dt>
              <dd className="text-right">
                {[registration.discord_nick, registration.twitch_nick, registration.boosty_nick]
                  .filter(Boolean)
                  .join(" · ")}
              </dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-3">
            <dt>Source</dt>
            <dd className="text-right">{registration.source}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>Submitted</dt>
            <dd className="text-right">{formatSubmittedAt(registration.submitted_at)}</dd>
          </div>
          {registration.reviewed_at ? (
            <div className="flex justify-between gap-3">
              <dt>Reviewed</dt>
              <dd className="text-right">
                {formatSubmittedAt(registration.reviewed_at)}
                {registration.reviewed_by_username
                  ? ` · ${registration.reviewed_by_username}`
                  : ""}
              </dd>
            </div>
          ) : null}
          {registration.notes ? (
            <div>
              <dt>Notes</dt>
              <dd className="mt-0.5">{registration.notes}</dd>
            </div>
          ) : null}
          {registration.admin_notes ? (
            <div>
              <dt>Admin notes</dt>
              <dd className="mt-0.5">{registration.admin_notes}</dd>
            </div>
          ) : null}
        </dl>
      </div>
    );
  };

  // Sub-route links keep the current query string so the legacy balancer route
  // (tournament id in the query) still resolves after navigating.
  const queryString = searchParams.toString();
  const withSearchParams = (path: string) => (queryString ? `${path}?${queryString}` : path);

  if (!tournamentId) {
    return (
      <Alert>
        <AlertTitle>Select a tournament</AlertTitle>
        <AlertDescription>
          Choose a tournament in the sidebar before managing registrations.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {reasonTally.length > 0 ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {reasonTally.map((entry) => (
            <span key={entry.code} className="inline-flex items-center gap-1">
              {/* Organizer-actionable entries are marked, not just sorted first:
                  they are the ones where the fix is a setting on this site
                  rather than a message to a player. */}
              {entry.actor === "organizer" ? (
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" aria-hidden />
              ) : null}
              <span className="tabular-nums">{entry.count}</span>
              {formatAdmissionReason(t, { code: entry.code, actor: entry.actor })}
            </span>
          ))}
        </p>
      ) : null}
      <AdminDataTable<AdminRegistration>
        rows={registrations}
        isLoading={registrationsQuery.isFetching}
        columns={columns}
        getRowId={(registration) => String(registration.id)}
        filters={filters}
        onFiltersChange={setFilters}
        initialSort={{ field: "submitted", dir: "desc" }}
        initialPageSize={25}
        paging="infinite"
        rowUnit="registrations"
        cellAlign="top"
        searchPlaceholder="Search registrations"
        emptyMessage="No registrations yet."
        columnsStorageKey="balancer-registrations-table-columns"
        enableRowSelection={(row) => row.original.status === "pending"}
        renderExpanded={renderRegistrationDetails}
        groupRows={groupBy === "none" ? undefined : groupPageRows}
        bulkActions={(selected, clearSelection) => (
          <>
            <Button
              onClick={() => {
                bulkApproveMutation.mutate(
                  selected.map((registration) => registration.id),
                  { onSuccess: clearSelection }
                );
              }}
              disabled={bulkApproveMutation.isPending}
            >
              {bulkApproveMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Approve {selected.length}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                bulkAddToBalancerMutation.mutate(
                  selected.map((registration) => registration.id),
                  { onSuccess: clearSelection }
                );
              }}
              disabled={bulkAddToBalancerMutation.isPending}
            >
              {bulkAddToBalancerMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Add to Balancer {selected.length}
            </Button>
          </>
        )}
        actions={
          <>
            <span
              className="shrink-0 text-xs tabular-nums text-muted-foreground"
              title={`${registrations.length} registrations`}
            >
              {registrations.length}
            </span>
            {pendingCount > 0 ? (
              <Button
                variant="outline"
                size="sm"
                className={cn("shrink-0 gap-1.5 text-amber-500")}
                aria-pressed={isPendingFilterOn}
                onClick={() =>
                  setFilters(
                    isPendingFilterOn
                      ? { ...filters, status: [] }
                      : { ...filters, status: ["pending"] }
                  )
                }
                title={
                  isPendingFilterOn
                    ? "Clear the pending filter"
                    : `Show only the ${pendingCount} pending registrations`
                }
              >
                <Clock className="h-3.5 w-3.5" aria-hidden />
                {pendingCount} pending
              </Button>
            ) : null}
            <Select
              value={groupBy}
              onValueChange={(value) => setGroupBy(value as RegistrationGroupingMode)}
            >
              <SelectTrigger className="w-[160px]" aria-label="Group registrations">
                <SelectValue placeholder="Group by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No grouping</SelectItem>
                <SelectItem value="check_in">Group by check-in</SelectItem>
                <SelectItem value="balancer_status">Group by balancer</SelectItem>
                <SelectItem value="admission">Group by admission</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => setCreateOpen(true)}>
              <UserPlus className="mr-2 h-4 w-4" />
              Create registration
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="Advanced registration actions">
                  <MoreHorizontal className="h-4 w-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Registration setup</DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link href={withSearchParams(`${basePath}/form`)}>
                    <FileCog className="mr-2 h-4 w-4" aria-hidden />
                    Form settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={withSearchParams(`${basePath}/feed`)}>
                    <Sheet className="mr-2 h-4 w-4" aria-hidden />
                    Google Sheets feed
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Bulk tools</DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link href={withSearchParams(`${basePath}/rank-autofill`)}>
                    <Sparkles className="mr-2 h-4 w-4" aria-hidden />
                    Autofill ranks
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={exportToUsersMutation.isPending}
                  onSelect={(event) => {
                    event.preventDefault();
                    exportToUsersMutation.mutate();
                  }}
                >
                  {exportToUsersMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Upload className="mr-2 h-4 w-4" aria-hidden />
                  )}
                  Export to analytics
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-3xl gap-0 overflow-hidden border-border bg-popover p-0 text-[color:var(--aqt-fg)] shadow-2xl shadow-black/50 sm:rounded-xl">
          <DialogHeader className="border-b border-[color:var(--aqt-border-2)] px-4 py-3.5 text-left sm:px-5">
            <DialogTitle className="text-xl font-semibold tracking-tight text-[color:var(--aqt-fg)]">
              Create Manual Registration
            </DialogTitle>
            <DialogDescription className="mt-1 max-w-2xl text-sm leading-5 text-[color:var(--aqt-fg-muted)]">
              Open the same multi-step visual shell used by the public flow, but keep every admin
              field available in one fixed editor.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[calc(100vh-12rem)] overflow-y-auto px-4 py-3.5 sm:px-5">
            <UnifiedRegistrationForm
              mode="admin"
              tournamentId={tournamentId}
              workspaceId={workspaceId as number}
              formConfig={roleForm}
              onSubmit={async (payload) => {
                await createMutation.mutateAsync(payload);
              }}
              onCancel={() => setCreateOpen(false)}
              submitPending={createMutation.isPending}
            />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editingRegistration !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditingRegistration(null);
          }
        }}
      >
        <DialogContent className="max-w-3xl gap-0 overflow-hidden border-border bg-popover p-0 text-[color:var(--aqt-fg)] shadow-2xl shadow-black/50 sm:rounded-xl">
          <DialogHeader className="border-b border-[color:var(--aqt-border-2)] px-4 py-3.5 text-left sm:px-5">
            <DialogTitle className="text-xl font-semibold tracking-tight text-[color:var(--aqt-fg)]">
              Edit Registration
            </DialogTitle>
            <DialogDescription className="mt-1 max-w-2xl text-sm leading-5 text-[color:var(--aqt-fg-muted)]">
              Update balancer-facing participant data in the fixed admin editor, while keeping the
              public multi-step look and hierarchy.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[calc(100vh-12rem)] space-y-4 overflow-y-auto px-4 py-3.5 sm:px-5">
            {editingRegistration && (
              // The change history used to sit here, inside this already-scrolling
              // dialog. It now lives in the row's "Change history" action, which
              // opens the shared drawer: a Radix sheet inside a Radix dialog
              // stacks two focus traps and two scroll locks on one screen.
              <UnifiedRegistrationForm
                mode="admin"
                tournamentId={tournamentId}
                workspaceId={workspaceId as number}
                formConfig={roleForm}
                initialData={editingRegistration}
                onSubmit={async (payload) => {
                  await updateMutation.mutateAsync(payload);
                }}
                onCancel={() => setEditingRegistration(null)}
                submitPending={updateMutation.isPending}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
