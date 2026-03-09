"use client";

import { useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Plus, Pencil, Trash2, RefreshCw } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { EntityFormDialog } from "@/components/admin/EntityFormDialog";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";

import { adminService } from "@/services/admin.service";
import type { Map, MapCreateInput, MapUpdateInput } from "@/types/admin.types";
import { customFetch } from "@/lib/custom_fetch";
import type { Gamemode } from "@/types/gamemode.types";

export default function MapsAdminPage() {
  const queryClient = useQueryClient();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingMap, setEditingMap] = useState<Map | null>(null);
  const [deletingMap, setDeletingMap] = useState<Map | null>(null);
  const [formData, setFormData] = useState<MapCreateInput | MapUpdateInput>({
    name: "",
    gamemode_id: 0,
  });

  // Fetch gamemodes for selector
  const { data: gamemodesData } = useQuery({
    queryKey: ["gamemodes"],
    queryFn: async () => {
      const response = await customFetch("/gamemodes");
      return response.json() as Promise<Gamemode[]>;
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: MapCreateInput) => adminService.createMap(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "maps"] });
      setCreateDialogOpen(false);
      setFormData({ name: "", gamemode_id: 0 });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: MapUpdateInput }) =>
      adminService.updateMap(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "maps"] });
      setEditingMap(null);
      setFormData({ name: "", gamemode_id: 0 });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminService.deleteMap(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "maps"] });
      setDeletingMap(null);
    },
  });

  const syncMutation = useMutation({
    mutationFn: () => adminService.syncMaps(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "maps"] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingMap) {
      updateMutation.mutate({ id: editingMap.id, data: formData as MapUpdateInput });
    } else {
      createMutation.mutate(formData as MapCreateInput);
    }
  };

  const columns: ColumnDef<Map>[] = [
    {
      accessorKey: "id",
      header: "ID",
      size: 80,
    },
    {
      accessorKey: "name",
      header: "Name",
    },
    {
      accessorKey: "gamemode",
      header: "Gamemode",
      cell: ({ row }) => {
        const map = row.original;
        return map.gamemode ? (
          <Badge variant="outline">{map.gamemode.name}</Badge>
        ) : (
          <span className="text-sm text-muted-foreground">Unknown</span>
        );
      },
    },
    {
      id: "actions",
      size: 50,
      cell: ({ row }) => {
        const map = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => {
                  setEditingMap(map);
                  setFormData({ name: map.name, gamemode_id: map.gamemode_id });
                }}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setDeletingMap(map)} className="text-destructive">
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Maps"
        description="Manage game maps"
        action={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`}
              />
              Sync from Game
            </Button>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Map
            </Button>
          </div>
        }
      />

      <AdminDataTable
        queryKey={["admin", "maps"]}
        queryFn={(params) => adminService.getMaps(params)}
        columns={columns}
        searchPlaceholder="Search maps..."
        emptyMessage="No maps found."
      />

      {/* Create/Edit Dialog */}
      <EntityFormDialog
        open={createDialogOpen || !!editingMap}
        onOpenChange={(open) => {
          if (!open) {
            setCreateDialogOpen(false);
            setEditingMap(null);
            setFormData({ name: "", gamemode_id: 0 });
          }
        }}
        title={editingMap ? "Edit Map" : "Create Map"}
        description={editingMap ? "Update map information" : "Create a new map in the game"}
        onSubmit={handleSubmit}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Map name"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="gamemode">Gamemode</Label>
            <Select
              value={formData.gamemode_id?.toString() || ""}
              onValueChange={(value) =>
                setFormData({ ...formData, gamemode_id: parseInt(value) })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select gamemode" />
              </SelectTrigger>
              <SelectContent>
                {gamemodesData?.map((gamemode) => (
                  <SelectItem key={gamemode.id} value={gamemode.id.toString()}>
                    {gamemode.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </EntityFormDialog>

      {/* Delete Confirmation */}
      {deletingMap && (
        <DeleteConfirmDialog
          open={!!deletingMap}
          onOpenChange={(open) => !open && setDeletingMap(null)}
          onConfirm={() => deleteMutation.mutate(deletingMap.id)}
          isDeleting={deleteMutation.isPending}
          entityName={deletingMap.name}
        />
      )}
    </div>
  );
}
