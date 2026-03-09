"use client";

import { useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Plus, Pencil, Trash2, RefreshCw } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

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
import type { Hero, HeroCreateInput, HeroUpdateInput } from "@/types/admin.types";

const HERO_ROLES = ["tank", "damage", "support"];

export default function HeroesAdminPage() {
  const queryClient = useQueryClient();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingHero, setEditingHero] = useState<Hero | null>(null);
  const [deletingHero, setDeletingHero] = useState<Hero | null>(null);
  const [formData, setFormData] = useState<HeroCreateInput | HeroUpdateInput>({
    name: "",
    role: "damage",
    color: "#3b82f6",
  });

  const createMutation = useMutation({
    mutationFn: (data: HeroCreateInput) => adminService.createHero(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "heroes"] });
      setCreateDialogOpen(false);
      setFormData({ name: "", role: "damage", color: "#3b82f6" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: HeroUpdateInput }) =>
      adminService.updateHero(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "heroes"] });
      setEditingHero(null);
      setFormData({ name: "", role: "damage", color: "#3b82f6" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminService.deleteHero(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "heroes"] });
      setDeletingHero(null);
    },
  });

  const syncMutation = useMutation({
    mutationFn: () => adminService.syncHeroes(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "heroes"] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingHero) {
      updateMutation.mutate({ id: editingHero.id, data: formData as HeroUpdateInput });
    } else {
      createMutation.mutate(formData as HeroCreateInput);
    }
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case "tank":
        return "bg-blue-500/10 text-blue-500 border-blue-500/20";
      case "damage":
        return "bg-red-500/10 text-red-500 border-red-500/20";
      case "support":
        return "bg-green-500/10 text-green-500 border-green-500/20";
      default:
        return "";
    }
  };

  const columns: ColumnDef<Hero>[] = [
    {
      accessorKey: "id",
      header: "ID",
      size: 80,
    },
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => {
        const hero = row.original;
        return (
          <div className="flex items-center gap-2">
            {hero.color && (
              <div
                className="w-4 h-4 rounded-full border border-border"
                style={{ backgroundColor: hero.color }}
              />
            )}
            <span>{hero.name}</span>
          </div>
        );
      },
    },
    {
      accessorKey: "role",
      header: "Role",
      cell: ({ row }) => {
        const role = row.getValue("role") as string;
        return (
          <Badge variant="outline" className={getRoleBadgeColor(role)}>
            {role}
          </Badge>
        );
      },
    },
    {
      id: "actions",
      size: 50,
      cell: ({ row }) => {
        const hero = row.original;
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
                  setEditingHero(hero);
                  setFormData({ name: hero.name, role: hero.role, color: hero.color });
                }}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setDeletingHero(hero)} className="text-destructive">
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
        title="Heroes"
        description="Manage game heroes and their roles"
        action={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
              Sync from Game
            </Button>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Hero
            </Button>
          </div>
        }
      />

      <AdminDataTable
        queryKey={["admin", "heroes"]}
        queryFn={(params) => adminService.getHeroes(params)}
        columns={columns}
        searchPlaceholder="Search heroes..."
        emptyMessage="No heroes found."
      />

      {/* Create/Edit Dialog */}
      <EntityFormDialog
        open={createDialogOpen || !!editingHero}
        onOpenChange={(open) => {
          if (!open) {
            setCreateDialogOpen(false);
            setEditingHero(null);
            setFormData({ name: "", role: "damage", color: "#3b82f6" });
          }
        }}
        title={editingHero ? "Edit Hero" : "Create Hero"}
        description={editingHero ? "Update hero information" : "Create a new hero in the game"}
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
              placeholder="Hero name"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="role">Role</Label>
            <Select
              value={formData.role}
              onValueChange={(value) => setFormData({ ...formData, role: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
              <SelectContent>
                {HERO_ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    {role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="color">Color</Label>
            <div className="flex items-center gap-2">
              <Input
                id="color"
                type="color"
                value={formData.color || "#3b82f6"}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                className="w-20 h-10 cursor-pointer"
              />
              <Input
                type="text"
                value={formData.color || ""}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                placeholder="#3b82f6"
                className="flex-1"
              />
            </div>
          </div>
        </div>
      </EntityFormDialog>

      {/* Delete Confirmation */}
      {deletingHero && (
        <DeleteConfirmDialog
          open={!!deletingHero}
          onOpenChange={(open) => !open && setDeletingHero(null)}
          onConfirm={() => deleteMutation.mutate(deletingHero.id)}
          isDeleting={deleteMutation.isPending}
          entityName={deletingHero.name}
        />
      )}
    </div>
  );
}
