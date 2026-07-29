"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, Trash2, CheckCircle, XCircle, Crown, Trophy } from "lucide-react";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatusIcon } from "@/components/admin/StatusIcon";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";
import tournamentService from "@/services/tournament.service";
import adminService from "@/services/admin.service";
import { Tournament } from "@/types/tournament.types";
import { usePermissions } from "@/hooks/usePermissions";
import { paginateResults, sortArray } from "@/lib/paginate-results";
import { formatTournamentStages } from "@/lib/tournament-stages";
import { useWorkspaceStore } from "@/stores/workspace.store";

export default function TournamentsPage() {
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
      queryClient.invalidateQueries({ queryKey: ["tournaments"] });
      setDeleteDialogOpen(false);
      setSelectedTournament(null);
      notify.success("Tournament deleted successfully");
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
      header: "Name",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{row.original.name}</span>
          {row.original.is_hidden ? (
            <Badge variant="outline" className="text-muted-foreground">
              Unpublished
            </Badge>
          ) : null}
        </div>
      )
    },
    {
      accessorKey: "is_league",
      header: "Type",
      cell: ({ row }) =>
        row.getValue("is_league") ? (
          <StatusIcon icon={Crown} label="League" variant="info" />
        ) : (
          <StatusIcon icon={Trophy} label="Tournament" variant="muted" />
        )
    },
    {
      accessorKey: "is_finished",
      header: "Status",
      cell: ({ row }) =>
        row.getValue("is_finished") ? (
          <StatusIcon icon={CheckCircle} label="Finished" variant="muted" />
        ) : (
          <StatusIcon icon={XCircle} label="Active" variant="success" />
        )
    },
    {
      accessorKey: "start_date",
      header: "Start Date",
      cell: ({ row }) => new Date(row.getValue("start_date")).toLocaleDateString()
    },
    {
      accessorKey: "end_date",
      header: "End Date",
      cell: ({ row }) => new Date(row.getValue("end_date")).toLocaleDateString()
    },
    {
      accessorKey: "stages",
      header: "Stages",
      enableSorting: false,
      cell: ({ row }) => {
        const stages = row.original.stages ?? [];
        if (stages.length === 0) {
          return <span className="text-muted-foreground">No stages</span>;
        }

        const stagesLabel = formatTournamentStages(stages);

        return (
          <div className="max-w-80">
            <div className="font-medium">
              {stages.length} {stages.length === 1 ? "stage" : "stages"}
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
              aria-label={`Delete ${row.original.name}`}
              variant="ghost"
              size="icon"
              onClick={() => handleDelete(row.original)}
              className="text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ) : null
    }
  ];

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Tournaments"
        description="Manage tournaments and their stages"
        actions={
          canCreate ? (
            <Button onClick={() => router.push("/admin/tournaments/new")}>
              <Plus className="mr-2 h-4 w-4" />
              Create Tournament
            </Button>
          ) : null
        }
      />

      <AdminDataTable
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
        searchPlaceholder="Search tournaments..."
        emptyMessage="No tournaments found."
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
            <AlertDialogTitle>Continue tournament setup?</AlertDialogTitle>
            <AlertDialogDescription>
              {`"${draftPromptTournament?.name}" is an unpublished draft without stages. Continue setup in the wizard, or open the tournament hub directly.`}
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
              Open hub
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => router.push("/admin/tournaments/new")}>
              Continue setup
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Dialog */}
      {canDelete ? (
        <DeleteConfirmDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          onConfirm={handleConfirmDelete}
          title="Delete Tournament"
          description={`Are you sure you want to delete "${selectedTournament?.name}"? This action cannot be undone.`}
          cascadeInfo={[
            "All tournament stages",
            "All teams in this tournament",
            "All players in these teams",
            "All encounters in this tournament",
            "All standings data"
          ]}
          isDeleting={deleteMutation.isPending}
        />
      ) : null}
    </div>
  );
}
