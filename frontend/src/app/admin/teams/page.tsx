"use client";

import { useId, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, Trash2, Users } from "lucide-react";

import TeamName from "@/components/TeamName";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { TeamCreateDialog } from "@/components/admin/teams/TeamCreateDialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { usePermissions } from "@/hooks/usePermissions";
import { notify } from "@/lib/notify";
import { paginateResults, sortArray } from "@/lib/paginate-results";
import adminService from "@/services/admin.service";
import teamService from "@/services/team.service";
import tournamentService from "@/services/tournament.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { Team } from "@/types/team.types";

const TOURNAMENT_QUERY_PARAM = "tournament";

function parseTournamentQueryParam(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export default function TeamsPage() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { canAccessPermission } = usePermissions();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const queryClient = useQueryClient();

  const canCreateTeam = canAccessPermission("team.create", workspaceId);
  const canDeleteTeam = canAccessPermission("team.delete", workspaceId);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const createHintId = useId();

  const selectedTournamentId = parseTournamentQueryParam(searchParams.get(TOURNAMENT_QUERY_PARAM));

  const { data: tournamentsData } = useQuery({
    queryKey: ["tournaments"],
    queryFn: () => tournamentService.getAll(null)
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminService.deleteTeam(id),
    onSuccess: () => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["teams"] }),
        queryClient.invalidateQueries({ queryKey: ["tournaments"] }),
        selectedTeam?.tournament_id != null
          ? queryClient.invalidateQueries({
              queryKey: ["admin", "tournament", selectedTeam.tournament_id, "teams"]
            })
          : Promise.resolve()
      ]);
      setDeleteDialogOpen(false);
      setSelectedTeam(null);
      notify.success("Team deleted successfully");
    }
  });

  const handleDelete = (team: Team) => {
    setSelectedTeam(team);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    if (selectedTeam) {
      deleteMutation.mutate(selectedTeam.id);
    }
  };

  const handleTournamentFilterChange = (value: string) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      nextParams.delete(TOURNAMENT_QUERY_PARAM);
    } else {
      nextParams.set(TOURNAMENT_QUERY_PARAM, value);
    }

    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const createBlockedReason =
    canCreateTeam && selectedTournamentId == null
      ? "Pick a tournament first — a roster belongs to one tournament."
      : null;

  const columns: ColumnDef<Team>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => <TeamName team={row.original} size="xs" nameClassName="font-medium" />
    },
    {
      accessorKey: "avg_sr",
      header: "Avg SR",
      cell: ({ row }) => <div className="tabular-nums">{row.getValue<number>("avg_sr").toFixed(0)}</div>
    },
    {
      accessorKey: "total_sr",
      header: "Total SR",
      cell: ({ row }) => <div className="tabular-nums">{row.getValue("total_sr")}</div>
    },
    {
      accessorKey: "players",
      header: "Players",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center gap-1 tabular-nums">
          <Users className="h-4 w-4" aria-hidden />
          {row.getValue<any[]>("players")?.length || 0}
        </div>
      )
    },
    {
      accessorKey: "tournament",
      header: "Tournament",
      enableSorting: false,
      cell: ({ row }) => {
        const tournament = row.getValue<any>("tournament");
        return tournament ? (
          <div className="text-sm text-muted-foreground">{tournament.name}</div>
        ) : (
          "—"
        );
      }
    },
    {
      id: "actions",
      cell: ({ row }) =>
        canDeleteTeam ? (
          <div className="flex items-center justify-end">
            <Button
              aria-label={`Delete ${row.original.name}`}
              variant="ghost"
              size="icon"
              onClick={(event) => {
                event.stopPropagation();
                handleDelete(row.original);
              }}
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
        title="Teams"
        description="Open a team to edit its name, captain and roster."
        actions={
          canCreateTeam ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {createBlockedReason ? (
                <span id={createHintId} className="text-sm text-muted-foreground">
                  {createBlockedReason}
                </span>
              ) : null}
              <Button
                onClick={() => setCreateDialogOpen(true)}
                disabled={createBlockedReason != null}
                aria-describedby={createBlockedReason ? createHintId : undefined}
              >
                <Plus className="mr-2 h-4 w-4" aria-hidden />
                Create team
              </Button>
            </div>
          ) : null
        }
      />

      <AdminDataTable
        queryKey={(page, search, pageSize, sortField, sortDir) => [
          "teams",
          selectedTournamentId,
          page,
          search,
          pageSize,
          sortField,
          sortDir
        ]}
        queryFn={async (page, search, pageSize, sortField, sortDir) => {
          const data = await teamService.getAll({ tournamentId: selectedTournamentId });
          const filteredTeams = search
            ? data.results.filter((team) => team.name.toLowerCase().includes(search.toLowerCase()))
            : data.results;
          const sorted = sortArray(filteredTeams, sortField, sortDir);

          return paginateResults(sorted, page, pageSize);
        }}
        columns={columns}
        searchPlaceholder="Search teams…"
        emptyMessage={
          selectedTournamentId
            ? "No teams in this tournament yet. Use “Create team” to add the first roster."
            : "No teams yet. Pick a tournament to see or create its rosters."
        }
        actions={
          <Select
            value={selectedTournamentId?.toString() ?? "all"}
            onValueChange={handleTournamentFilterChange}
          >
            <SelectTrigger className="w-[220px]" aria-label="Filter by tournament">
              <SelectValue placeholder="Filter by tournament" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tournaments</SelectItem>
              {tournamentsData?.results.map((tournament) => (
                <SelectItem key={tournament.id} value={tournament.id.toString()}>
                  {tournament.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        onRowClick={(row) => router.push(`/admin/teams/${row.original.id}`)}
      />

      {selectedTournamentId != null ? (
        <TeamCreateDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          tournamentId={selectedTournamentId}
        />
      ) : null}

      {canDeleteTeam ? (
        <DeleteConfirmDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          onConfirm={handleConfirmDelete}
          title="Delete team"
          description={`Deleting “${selectedTeam?.name}” removes the roster from its tournament along with every player and match statistic below. This cannot be undone.`}
          cascadeInfo={["All players in this team", "All related match statistics"]}
          isDeleting={deleteMutation.isPending}
        />
      ) : null}
    </div>
  );
}
