"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, Pencil, Trash2, CheckCircle, XCircle } from "lucide-react";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { EntityFormDialog } from "@/components/admin/EntityFormDialog";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import tournamentService from "@/services/tournament.service";
import adminService from "@/services/admin.service";
import { Tournament } from "@/types/tournament.types";
import { TournamentCreateInput, TournamentUpdateInput } from "@/types/admin.types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { usePermissions } from "@/hooks/usePermissions";
import { hasUnsavedChanges } from "@/lib/form-change";
import { paginateResults, sortArray } from "@/lib/paginate-results";

const emptyTournamentForm: TournamentCreateInput = {
  name: "",
  description: "",
  is_league: false,
  start_date: "",
  end_date: "",
};

function getTournamentEditForm(tournament: Tournament): TournamentUpdateInput {
  return {
    name: tournament.name,
    description: tournament.description || "",
    is_finished: tournament.is_finished,
    start_date: new Date(tournament.start_date).toISOString().split("T")[0],
    end_date: new Date(tournament.end_date).toISOString().split("T")[0],
  };
}

export default function TournamentsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const queryClient = useQueryClient();
  const canCreate = hasPermission("tournament.create");
  const canUpdate = hasPermission("tournament.update");
  const canDelete = hasPermission("tournament.delete");

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedTournament, setSelectedTournament] = useState<Tournament | null>(null);

  // Form state
  const [formData, setFormData] = useState<TournamentCreateInput | TournamentUpdateInput>({
    ...emptyTournamentForm,
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: TournamentCreateInput) => adminService.createTournament(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tournaments"] });
      setCreateDialogOpen(false);
      resetForm();
      toast({ title: "Tournament created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: TournamentUpdateInput }) =>
      adminService.updateTournament(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tournaments"] });
      setEditDialogOpen(false);
      setSelectedTournament(null);
      resetForm();
      toast({ title: "Tournament updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminService.deleteTournament(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tournaments"] });
      setDeleteDialogOpen(false);
      setSelectedTournament(null);
      toast({ title: "Tournament deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const resetForm = () => {
    setFormData({ ...emptyTournamentForm });
  };

  const handleCreate = () => {
    createMutation.reset();
    setCreateDialogOpen(true);
    resetForm();
  };

  const handleEdit = (tournament: Tournament) => {
    updateMutation.reset();
    setSelectedTournament(tournament);
    setFormData(getTournamentEditForm(tournament));
    setEditDialogOpen(true);
  };

  const handleDelete = (tournament: Tournament) => {
    setSelectedTournament(tournament);
    setDeleteDialogOpen(true);
  };

  const handleSubmitCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(formData as TournamentCreateInput);
  };

  const handleSubmitUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedTournament) {
      updateMutation.mutate({
        id: selectedTournament.id,
        data: formData as TournamentUpdateInput
      });
    }
  };

  const handleConfirmDelete = () => {
    if (selectedTournament) {
      deleteMutation.mutate(selectedTournament.id);
    }
  };

  const editFormInitial = selectedTournament ? getTournamentEditForm(selectedTournament) : emptyTournamentForm;
  const isCreateDirty = createDialogOpen && hasUnsavedChanges(formData, emptyTournamentForm);
  const isEditDirty = editDialogOpen && hasUnsavedChanges(formData, editFormInitial);

  const columns: ColumnDef<Tournament>[] = [
    {
      accessorKey: "number",
      header: "#",
      cell: ({ row }) => <div className="font-medium">{row.getValue("number") || "—"}</div>
    },
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => <div className="font-medium">{row.getValue("name")}</div>
    },
    {
      accessorKey: "is_league",
      header: "Type",
      cell: ({ row }) => (
        <Badge variant={row.getValue("is_league") ? "default" : "secondary"}>
          {row.getValue("is_league") ? "League" : "Tournament"}
        </Badge>
      )
    },
    {
      accessorKey: "is_finished",
      header: "Status",
      cell: ({ row }) =>
        row.getValue("is_finished") ? (
          <Badge variant="outline" className="gap-1">
            <CheckCircle className="h-3 w-3" />
            Finished
          </Badge>
        ) : (
          <Badge variant="default" className="gap-1">
            <XCircle className="h-3 w-3" />
            Active
          </Badge>
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
      id: "actions",
      cell: ({ row }) =>
        canUpdate || canDelete ? (
          <div className="flex items-center gap-2">
            {canUpdate ? (
              <Button aria-label={`Edit ${row.original.name}`} variant="ghost" size="icon" onClick={() => handleEdit(row.original)}>
                <Pencil className="h-4 w-4" />
              </Button>
            ) : null}
            {canDelete ? (
              <Button
                aria-label={`Delete ${row.original.name}`}
                variant="ghost"
                size="icon"
                onClick={() => handleDelete(row.original)}
                className="text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        ) : null
    }
  ];

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Tournaments"
        description="Manage tournaments and their groups"
        actions={
          canCreate ? (
            <Button onClick={handleCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Create Tournament
            </Button>
          ) : null
        }
      />

      <AdminDataTable
        queryKey={(page, search, pageSize, sortField, sortDir) => ["tournaments", page, search, pageSize, sortField, sortDir]}
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
        onRowClick={(row) => router.push(`/admin/tournaments/${row.original.id}`)}
      />

      {/* Create Dialog */}
      <EntityFormDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        title="Create Tournament"
        description="Create a new tournament"
        onSubmit={handleSubmitCreate}
        isSubmitting={createMutation.isPending}
        submittingLabel="Creating tournament…"
        errorMessage={createMutation.isError ? createMutation.error.message : undefined}
        isDirty={isCreateDirty}
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>

          <div>
            <Label htmlFor="number">Number</Label>
            <Input
              id="number"
              type="number"
              value={(formData as TournamentCreateInput).number || ""}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  number: e.target.value ? parseInt(e.target.value) : undefined
                })
              }
            />
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description ?? ""}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="is_league"
              checked={(formData as TournamentCreateInput).is_league}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, is_league: checked as boolean })
              }
            />
            <Label htmlFor="is_league" className="cursor-pointer">
              Is League
            </Label>
          </div>

          <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="start_date">Start Date *</FieldLabel>
              <DatePicker
                id="start_date"
                value={formData.start_date}
                onChange={(value) => setFormData({ ...formData, start_date: value })}
                placeholder="June 01, 2025"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="end_date">End Date *</FieldLabel>
              <DatePicker
                id="end_date"
                value={formData.end_date}
                onChange={(value) => setFormData({ ...formData, end_date: value })}
                placeholder="June 30, 2025"
              />
            </Field>
          </FieldGroup>
        </div>
      </EntityFormDialog>

      {/* Edit Dialog */}
      <EntityFormDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        title="Edit Tournament"
        description="Update tournament details"
        onSubmit={handleSubmitUpdate}
        isSubmitting={updateMutation.isPending}
        submittingLabel="Updating tournament…"
        errorMessage={updateMutation.isError ? updateMutation.error.message : undefined}
        isDirty={isEditDirty}
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="edit-name">Name</Label>
            <Input
              id="edit-name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div>
            <Label htmlFor="edit-description">Description</Label>
            <Textarea
              id="edit-description"
              value={formData.description ?? ""}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="is_finished"
              checked={(formData as TournamentUpdateInput).is_finished}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, is_finished: checked as boolean })
              }
            />
            <Label htmlFor="is_finished" className="cursor-pointer">
              Is Finished
            </Label>
          </div>

          <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="edit-start_date">Start Date</FieldLabel>
              <DatePicker
                id="edit-start_date"
                value={formData.start_date}
                onChange={(value) => setFormData({ ...formData, start_date: value })}
                placeholder="June 01, 2025"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="edit-end_date">End Date</FieldLabel>
              <DatePicker
                id="edit-end_date"
                value={formData.end_date}
                onChange={(value) => setFormData({ ...formData, end_date: value })}
                placeholder="June 30, 2025"
              />
            </Field>
          </FieldGroup>
        </div>
      </EntityFormDialog>

      {/* Delete Dialog */}
      {canDelete ? (
        <DeleteConfirmDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          onConfirm={handleConfirmDelete}
          title="Delete Tournament"
          description={`Are you sure you want to delete "${selectedTournament?.name}"? This action cannot be undone.`}
          cascadeInfo={[
            "All tournament groups",
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
