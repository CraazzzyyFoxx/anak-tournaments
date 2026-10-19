"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { DataTable } from "@/components/data-table";
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
import { notify } from "@/lib/notify";
import tournamentService from "@/services/tournament.service";
import adminService from "@/services/admin.service";
import type { Tournament } from "@/types/tournament.types";
import { usePermissions } from "@/hooks/usePermissions";
import { paginateResults, sortArray } from "@/lib/api/paginate-results";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { tournamentQueryKeys } from "@/lib/tournament/query-keys";

import { useTournamentColumns } from "./useTournamentColumns";

/**
 * Every tournament in the workspace. A row opens the tournament hub, except an
 * unpublished one with no stages yet, which is a wizard left half-way: that one
 * asks whether to resume the wizard or open the hub anyway.
 */
export function TournamentsBrowser() {
  const t = useTranslations("adminTournaments.list");
  const router = useRouter();
  const { canAccessPermission } = usePermissions();
  const queryClient = useQueryClient();
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
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

  const handleDelete = useCallback((tournament: Tournament) => {
    setSelectedTournament(tournament);
    setDeleteDialogOpen(true);
  }, []);

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

  const columns = useTournamentColumns({ canDelete, onDelete: handleDelete });

  return (
    <>
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
    </>
  );
}
