"use client";

import { useMemo, useState } from "react";
import { Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { ColumnDef, Row } from "@tanstack/react-table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import StatusMetaBadge from "@/components/status/StatusMetaBadge";
import { DataTable, type DataTableGroup, columnMeta, createKebabColumn } from "@/components/data-table";
import { FilterBar } from "@/components/kit/FilterBar";
import { ConfirmDialog, type ConfirmIntent } from "@/components/kit/ConfirmDialog";
import { useFilters, type FilterDef } from "@/components/kit/useFilters";
import {
  EMPTY_STATUS_FORM,
  StatusForm,
  type StatusFormState
} from "@/components/admin/statuses/StatusForm";
import { StatusPill } from "@/components/kit/StatusPill";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { PageStateCard } from "@/components/ui/page-state-card";
import { usePermissions } from "@/hooks/usePermissions";
import { notify } from "@/lib/notify";
import balancerAdminService from "@/services/balancer-admin.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type {
  BalancerCustomStatus,
  BalancerCustomStatusCreateInput,
  BalancerCustomStatusUpdateInput
} from "@/types/balancer-admin.types";
import type { StatusScope } from "@/types/registration.types";
import { balancerQueryKeys } from "@/lib/balancer/query-keys";

/** `StatusMetaBadge` renders from the shared `StatusMeta` shape, which the
 *  catalog row nearly is: it carries no `value`, and its edit/delete grants are
 *  a property of the kind rather than of the row. */
function badgeMeta(row: BalancerCustomStatus) {
  const isBuiltin = row.kind === "builtin";
  return {
    value: row.slug,
    scope: row.scope,
    is_builtin: isBuiltin,
    kind: row.kind,
    is_override: row.is_override,
    can_edit: true,
    can_delete: !isBuiltin,
    can_reset: isBuiltin && row.can_reset,
    icon_slug: row.icon_slug,
    icon_color: row.icon_color,
    name: row.name,
    description: row.description,
    excludes_from_balancer: row.excludes_from_balancer,
    excludes_from_ready: row.excludes_from_ready
  };
}

/**
 * Workspace status catalog: the registration and balancer statuses every
 * tournament in the workspace shares.
 *
 * One table, two groups. The screen used to be four hand-rolled tables — a
 * system/custom pair per scope — which meant a status's row looked different
 * depending on which of the four it landed in, and the scope was structural
 * rather than something you could filter by.
 */
export default function WorkspaceStatusesSettingsPage() {
  const t = useTranslations("adminSettings.statuses");
  const scopeLabels: Record<StatusScope, string> = useMemo(
    () => ({ registration: t("scope.registration"), balancer: t("scope.balancer") }),
    [t]
  );
  const filterDefs: FilterDef[] = [
    {
      key: "scope",
      label: t("columns.scope"),
      kind: "single",
      options: [
        { value: "registration", label: t("scope.registration") },
        { value: "balancer", label: t("scope.balancer") }
      ]
    }
  ];
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const { canAccessPermission } = usePermissions();
  const queryClient = useQueryClient();
  const filters = useFilters(filterDefs);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingStatus, setEditingStatus] = useState<BalancerCustomStatus | null>(null);
  const [pendingStatus, setPendingStatus] = useState<BalancerCustomStatus | null>(null);
  const [form, setForm] = useState<StatusFormState>(EMPTY_STATUS_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  // D12: page is readable with team.read; mutations follow the server matrix (team.update).
  const canManageStatuses = canAccessPermission("team.update", workspaceId);

  const statusesQuery = useQuery({
    queryKey: balancerQueryKeys.statusCatalog(workspaceId),
    queryFn: () => balancerAdminService.listStatusCatalog(workspaceId as number),
    enabled: workspaceId !== null
  });

  const invalidateStatuses = async () => {
    await queryClient.invalidateQueries({
      queryKey: balancerQueryKeys.statusCatalog(workspaceId)
    });
  };

  const createMutation = useMutation({
    mutationFn: (data: BalancerCustomStatusCreateInput) =>
      balancerAdminService.createCustomStatus(workspaceId as number, data),
    onSuccess: async () => {
      await invalidateStatuses();
      setCreateOpen(false);
      setForm(EMPTY_STATUS_FORM);
      notify.success(t("toast.customCreated"));
    },
    onError: (error) => {
      notify.apiError(error, { title: t("errors.create") });
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ statusId, data }: { statusId: number; data: BalancerCustomStatusUpdateInput }) =>
      balancerAdminService.updateCustomStatus(workspaceId as number, statusId, data),
    onSuccess: async () => {
      await invalidateStatuses();
      setEditingStatus(null);
      setForm(EMPTY_STATUS_FORM);
      notify.success(t("toast.customUpdated"));
    },
    onError: (error) => {
      notify.apiError(error, { title: t("errors.save") });
    }
  });

  const updateBuiltinMutation = useMutation({
    mutationFn: ({
      scope,
      slug,
      data
    }: {
      scope: StatusScope;
      slug: string;
      data: BalancerCustomStatusUpdateInput;
    }) =>
      balancerAdminService.upsertBuiltinStatusOverride(workspaceId as number, scope, slug, data),
    onSuccess: async () => {
      await invalidateStatuses();
      setEditingStatus(null);
      setForm(EMPTY_STATUS_FORM);
      notify.success(t("toast.systemUpdated"));
    },
    onError: (error) => {
      notify.apiError(error, { title: t("errors.systemSave") });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (statusId: number) =>
      balancerAdminService.deleteCustomStatus(workspaceId as number, statusId),
    onSuccess: async () => {
      await invalidateStatuses();
      setPendingStatus(null);
      notify.success(t("toast.customDeleted"));
    },
    onError: (error) => {
      notify.apiError(error, { title: t("errors.delete") });
    }
  });

  const resetBuiltinMutation = useMutation({
    mutationFn: ({ scope, slug }: { scope: StatusScope; slug: string }) =>
      balancerAdminService.resetBuiltinStatusOverride(workspaceId as number, scope, slug),
    onSuccess: async () => {
      await invalidateStatuses();
      setPendingStatus(null);
      notify.success(t("toast.systemReset"));
    },
    onError: (error) => {
      notify.apiError(error, { title: t("errors.reset") });
    }
  });

  const scopeFilter = typeof filters.values.scope === "string" ? filters.values.scope : "";
  const rows = useMemo(() => {
    const all = statusesQuery.data ?? [];
    return scopeFilter ? all.filter((row) => row.scope === scopeFilter) : all;
  }, [statusesQuery.data, scopeFilter]);

  const openEdit = (statusRow: BalancerCustomStatus) => {
    setEditingStatus(statusRow);
    setForm({
      scope: statusRow.scope,
      icon_slug: statusRow.icon_slug ?? "",
      icon_color: statusRow.icon_color ?? "",
      name: statusRow.name,
      description: statusRow.description ?? "",
      excludes_from_balancer: statusRow.excludes_from_balancer,
      excludes_from_ready: statusRow.excludes_from_ready
    });
  };

  const columns = useMemo<ColumnDef<BalancerCustomStatus>[]>(
    () => [
      {
        id: "status",
        accessorFn: (row) => row.name,
        header: t("columns.status"),
        meta: columnMeta<BalancerCustomStatus>({
          category: "core",
          mandatory: true,
          searchValue: (row) => `${row.name} ${row.slug}`
        }),
        cell: ({ row }) => (
          <StatusMetaBadge meta={badgeMeta(row.original)} fallbackValue={row.original.slug} />
        )
      },
      {
        id: "scope",
        accessorFn: (row) => scopeLabels[row.scope],
        header: t("columns.scope"),
        meta: columnMeta<BalancerCustomStatus>({
          category: "core",
          searchValue: (row) => scopeLabels[row.scope]
        }),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{scopeLabels[row.original.scope]}</span>
        )
      },
      {
        id: "slug",
        accessorFn: (row) => row.slug,
        header: t("columns.slug"),
        meta: columnMeta<BalancerCustomStatus>({
          category: "meta",
          searchValue: (row) => row.slug
        }),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.slug}</span>
      },
      {
        id: "description",
        accessorFn: (row) => row.description ?? "",
        header: t("columns.description"),
        enableSorting: false,
        meta: columnMeta<BalancerCustomStatus>({ category: "core" }),
        cell: ({ row }) => (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{row.original.description ?? "—"}</span>
            {row.original.excludes_from_balancer ? (
              <StatusPill tone="warning">{t("badges.excludesPool")}</StatusPill>
            ) : null}
            {row.original.excludes_from_ready ? (
              <StatusPill tone="warning">{t("badges.blocksReady")}</StatusPill>
            ) : null}
          </div>
        )
      },
      createKebabColumn<BalancerCustomStatus>(
        (row) => [
          {
            label: t("actions.edit"),
            icon: Pencil,
            hidden: !canManageStatuses,
            onSelect: () => openEdit(row)
          },
          {
            label: t("actions.resetDefault"),
            icon: RotateCcw,
            hidden: !canManageStatuses || row.kind !== "builtin" || !row.can_reset,
            onSelect: () => setPendingStatus(row)
          },
          {
            label: t("actions.delete"),
            icon: Trash2,
            destructive: true,
            hidden: !canManageStatuses || row.kind === "builtin",
            onSelect: () => setPendingStatus(row)
          }
        ],
        {
          rowLabel: (row) =>
            t("rowLabel", {
              name: row.name,
              kind: row.kind === "builtin" ? t("systemKind") : t("customKind")
            })
        }
      )
    ],
    [canManageStatuses, scopeLabels, t]
  );

  /** System first: those exist in every workspace, so they are the reference a
   *  custom status is read against. */
  const groupRows = (
    pageRows: Row<BalancerCustomStatus>[]
  ): DataTableGroup<BalancerCustomStatus>[] =>
    [
      { key: "builtin", label: t("system"), rows: pageRows.filter((r) => r.original.kind === "builtin") },
      { key: "custom", label: t("custom"), rows: pageRows.filter((r) => r.original.kind !== "builtin") }
    ].filter((group) => group.rows.length > 0);

  const submitCreate = () => {
    if (!form.name.trim()) {
      setFormError(t("validation.createName"));
      return;
    }
    setFormError(null);
    createMutation.mutate({
      scope: form.scope,
      icon_slug: form.icon_slug || null,
      icon_color: form.icon_color || null,
      name: form.name,
      description: form.description || null,
      excludes_from_balancer: form.scope === "balancer" ? form.excludes_from_balancer : false,
      excludes_from_ready: form.scope === "balancer" ? form.excludes_from_ready : false
    });
  };

  const submitEdit = () => {
    if (!editingStatus) return;
    if (!form.name.trim()) {
      setFormError(t("validation.saveName"));
      return;
    }
    setFormError(null);
    if (editingStatus.kind === "builtin") {
      updateBuiltinMutation.mutate({
        scope: editingStatus.scope,
        slug: editingStatus.slug,
        data: {
          icon_slug: form.icon_slug || null,
          icon_color: form.icon_color || null,
          name: form.name,
          description: form.description || null
        }
      });
      return;
    }
    updateMutation.mutate({
      statusId: editingStatus.id,
      data: {
        icon_slug: form.icon_slug || null,
        icon_color: form.icon_color || null,
        name: form.name,
        description: form.description || null,
        excludes_from_balancer:
          editingStatus.scope === "balancer" ? form.excludes_from_balancer : false,
        excludes_from_ready: editingStatus.scope === "balancer" ? form.excludes_from_ready : false
      }
    });
  };

  // Resetting a built-in and deleting a custom status are different promises:
  // one restores a default that is still there, the other removes a label the
  // workspace invented. Same dialog, swapped intent.
  const isReset = pendingStatus?.kind === "builtin";
  const confirmIntent: ConfirmIntent = isReset
    ? {
        title: t("confirm.resetTitle"),
        tone: "warning",
        confirmLabel: t("confirm.reset"),
        description: t("confirm.resetDescription", { name: pendingStatus?.name ?? "" })
      }
    : {
        title: t("confirm.deleteTitle"),
        tone: "danger",
        confirmLabel: t("confirm.delete"),
        description: t("confirm.deleteDescription", { name: pendingStatus?.name ?? "" })
      };

  if (workspaceId === null) {
    return (
      <PageStateCard
        state="empty"
        title={t("noWorkspace.title")}
        description={t("noWorkspace.description")}
      />
    );
  }

  if (statusesQuery.isError) {
    return (
      <PageStateCard
        state="error"
        title={t("loadError.title")}
        onAction={() => void statusesQuery.refetch()}
        actionLabel={t("tryAgain")}
      />
    );
  }

  return (
    <div className="space-y-4">
      <DataTable<BalancerCustomStatus>
        rows={rows}
        isLoading={statusesQuery.isLoading}
        columns={columns}
        getRowId={(row) => `${row.kind}:${row.scope}:${row.slug}`}
        filterKey={filters.filterKey}
        groupRows={groupRows}
        searchPlaceholder={t("search")}
        emptyMessage={t("empty")}
        initialPageSize={25}
        columnsStorageKey="workspace-statuses-table-columns"
        toolbar={
          <FilterBar
            defs={filterDefs}
            filters={filters}
            trailing={
              canManageStatuses ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setForm({
                      ...EMPTY_STATUS_FORM,
                      // The scope chip is the admin's current context, so a new
                      // status starts in the scope they are looking at.
                      scope: scopeFilter === "balancer" ? "balancer" : "registration"
                    });
                    setCreateOpen(true);
                  }}
                >
                  <Plus className="mr-2 size-4" aria-hidden />
                  {t("add")}
                </Button>
              ) : null
            }
          />
        }
      />

      <p className="text-xs text-muted-foreground">
        {t("note")}
      </p>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setFormError(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("createTitle")}</DialogTitle>
            <DialogDescription>
              {t("createDescription")}
            </DialogDescription>
          </DialogHeader>
          <StatusForm value={form} onChange={setForm} />
          {formError && <p className="text-sm text-danger">{formError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              onClick={submitCreate}
              disabled={createMutation.isPending || !canManageStatuses}
            >
              {createMutation.isPending ? t("creating") : t("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editingStatus !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditingStatus(null);
            setForm(EMPTY_STATUS_FORM);
            setFormError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingStatus?.kind === "builtin" ? t("editSystemTitle") : t("editCustomTitle")}
            </DialogTitle>
            <DialogDescription>
              {editingStatus?.kind === "builtin"
                ? t("editSystemDescription")
                : t("editCustomDescription")}
            </DialogDescription>
          </DialogHeader>
          <StatusForm
            value={form}
            onChange={setForm}
            disableScope
            isBuiltin={editingStatus?.kind === "builtin"}
          />
          {formError && <p className="text-sm text-danger">{formError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingStatus(null)}>
              {t("cancel")}
            </Button>
            <Button
              onClick={submitEdit}
              disabled={
                updateMutation.isPending || updateBuiltinMutation.isPending || !canManageStatuses
              }
            >
              {updateMutation.isPending || updateBuiltinMutation.isPending
                ? t("saving")
                : t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingStatus !== null}
        onOpenChange={(open) => !open && setPendingStatus(null)}
        intent={confirmIntent}
        pending={deleteMutation.isPending || resetBuiltinMutation.isPending}
        onConfirm={() => {
          if (!pendingStatus) return;
          if (pendingStatus.kind === "builtin") {
            resetBuiltinMutation.mutate({
              scope: pendingStatus.scope,
              slug: pendingStatus.slug
            });
            return;
          }
          deleteMutation.mutate(pendingStatus.id);
        }}
      />
    </div>
  );
}
