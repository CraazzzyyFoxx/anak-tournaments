"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, Trash2, CheckCircle, CircleDot, Crown, EyeOff, Trophy } from "lucide-react";
import { useFormatter } from "@/lib/datetime/client";
import { DataTable, columnMeta } from "@/components/data-table";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatusIcon } from "@/components/admin/StatusIcon";
import { ConfirmDialog } from "@/components/kit/ConfirmDialog";
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
import { notify } from "@/lib/notify";
import tournamentService from "@/services/tournament.service";
import adminService from "@/services/admin.service";
import { Tournament } from "@/types/tournament.types";
import { usePermissions } from "@/hooks/usePermissions";
import { paginateResults, sortArray } from "@/lib/api/paginate-results";
import { formatTournamentStages } from "@/lib/tournament/stages";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { tournamentQueryKeys } from "@/lib/tournament/query-keys";

export default function TournamentsPage() {
  const t = useTranslations("adminTournaments.list");
  const format = useFormatter();
  const router = useRouter();
  const { canAccessPermission } = usePermissions();
  const queryClient = useQueryClient();
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const canCreate = canAccessPermission("tournament.create", currentWorkspaceId);
  const canDelete = canAccessPermission("tournament.delete", currentWorkspaceId);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedTournament, setSelectedTournament] = useState<Tournament | null>(null);
  const [draftPromptTournament, setDraftPromptTournament] = useState<Tournament | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminService.deleteTournament(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tournamentQueryKeys.list() });
      setDeleteDialogOpen(false);
      setSelectedTournament(null);
      notify.success(t("deleted"));
    }
  });

  const handleDelete = (tournament: Tournament) => {
    setSelectedTournament(tournament);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    if (selectedTournament) {
      deleteMutation.mutate(selectedTournament.id);
    }
  };

  const handleRowClick = (tournament: Tournament) => {
    if (tournament.is_hidden && (tournament.stages ?? []).length === 0) {
      setDraftPromptTournament(tournament);
      return;
    }
    router.push(`/admin/tournaments/${tournament.id}`);
  };

  const columns: ColumnDef<Tournament>[] = [
    {
      accessorKey: "name",
      header: t("columns.name"),
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{row.original.name}</span>
          {row.original.is_hidden ? (
            <StatusIcon icon={EyeOff} label={t("status.unpublished")} variant="muted" />
          ) : null}
        </div>
      )
    },
    {
      accessorKey: "is_league",
      header: t("columns.type"),
      meta: columnMeta<Tournament>({ align: "center" }),
      cell: ({ row }) =>
        row.getValue("is_league") ? (
          <StatusIcon icon={Crown} label={t("type.league")} variant="info" />
        ) : (
          <StatusIcon icon={Trophy} label={t("type.tournament")} variant="muted" />
        )
    },
    {
      accessorKey: "is_finished",
      header: t("columns.status"),
      meta: columnMeta<Tournament>({ align: "center" }),
      cell: ({ row }) =>
        row.getValue("is_finished") ? (
          <StatusIcon icon={CheckCircle} label={t("status.finished")} variant="muted" />
        ) : (
          <StatusIcon icon={CircleDot} label={t("status.active")} variant="success" />
        )
    },
    {
      accessorKey: "start_date",
      header: t("columns.startDate"),
      cell: ({ row }) => (
        <span className="tabular-nums">
          {/* Tournament days are UTC midnights — read in UTC. */}
          {format.dateTime(new Date(row.getValue("start_date")), { dateStyle: "medium", timeZone: "UTC" })}
        </span>
      )
    },
    {
      accessorKey: "end_date",
      header: t("columns.endDate"),
      cell: ({ row }) => (
        <span className="tabular-nums">
          {format.dateTime(new Date(row.getValue("end_date")), { dateStyle: "medium", timeZone: "UTC" })}
        </span>
      )
    },
    {
      accessorKey: "stages",
      header: t("columns.stages"),
      enableSorting: false,
      cell: ({ row }) => {
        const stages = row.original.stages ?? [];
        if (stages.length === 0) {
          return <span className="text-muted-foreground">{t("noStages")}</span>;
        }

        const stagesLabel = formatTournamentStages(stages);

        return (
          <div className="max-w-80">
            <div className="font-medium tabular-nums">
              {t("stageCount", { count: stages.length })}
            </div>
            <div className="truncate text-xs text-muted-foreground" title={stagesLabel}>
              {stagesLabel}
            </div>
          </div>
        );
      }
    },
    {
      id: "actions",
      cell: ({ row }) =>
        canDelete ? (
          <div className="flex items-center gap-2">
            <Button
              aria-label={t("deleteAria", { name: row.original.name })}
              variant="ghost"
              size="icon"
              onClick={() => handleDelete(row.original)}
              className="text-destructive"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        ) : null
    }
  ];

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title={t("title")}
        description={t("description")}
        actions={
          canCreate ? (
            <Button size="sm" onClick={() => router.push("/admin/tournaments/new")}>
              <Plus className="size-3.5" aria-hidden />
              {t("create")}
            </Button>
          ) : null
        }
      />

      <DataTable
        queryKey={(page, search, pageSize, sortField, sortDir) => [
          "tournaments",
          page,
          search,
          pageSize,
          sortField,
          sortDir
        ]}
        queryFn={(page, search, pageSize, sortField, sortDir) =>
          tournamentService.getAll(null).then((data) => {
            const filtered = search
              ? data.results.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
              : data.results;
            return { ...paginateResults(sortArray(filtered, sortField, sortDir), page, pageSize) };
          })
        }
        columns={columns}
        searchPlaceholder={t("searchPlaceholder")}
        emptyMessage={t("empty")}
        onRowClick={(row) => handleRowClick(row.original)}
      />

      {/* Draft resume prompt */}
      <AlertDialog
        open={draftPromptTournament !== null}
        onOpenChange={(open) => {
          if (!open) setDraftPromptTournament(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("resumeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("resumeDescription", { name: draftPromptTournament?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                if (draftPromptTournament) {
                  router.push(`/admin/tournaments/${draftPromptTournament.id}`);
                }
              }}
            >
              {t("openHub")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => router.push("/admin/tournaments/new")}>
              {t("resumeWizard")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Dialog */}
      {canDelete ? (
        <ConfirmDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          onConfirm={handleConfirmDelete}
          pending={deleteMutation.isPending}
          intent={{
            title: t("deleteTitle"),
            description: t("deleteDescription", { name: selectedTournament?.name ?? "" }),
            confirmLabel: deleteMutation.isPending ? t("deleting") : t("delete"),
            tone: "danger",
            cascade: [
              t("cascade.stages"),
              t("cascade.teams"),
              t("cascade.players"),
              t("cascade.encounters"),
              t("cascade.standings")
            ]
          }}
        />
      ) : null}
    </div>
  );
}
