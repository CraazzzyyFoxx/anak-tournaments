"use client";

import { useId, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AssetPreview } from "@/components/admin/AssetPreview";
import { CatalogAliasesField, CatalogNameField } from "@/components/admin/CatalogFormFields";
import {
  CatalogToolbarActions,
  entityFormError,
  onEntityDialogClose
} from "@/components/admin/CatalogToolbarActions";
import { EntityFormDialog } from "@/components/admin/EntityFormDialog";
import { createAliasesColumn, createEntityActionsColumn } from "@/components/admin/catalog-table-columns";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import adminService from "@/services/admin.service";
import type { MapRead } from "@/types/map.types";
import type { MapCreateInput, MapUpdateInput } from "@/types/admin.types";
import { apiFetch } from "@/lib/api-fetch";
import type { Gamemode } from "@/types/gamemode.types";
import type { PaginatedResponse } from "@/types/pagination.types";
import { usePermissions } from "@/hooks/usePermissions";
import { hasUnsavedChanges } from "@/lib/form-change";

// Key order matters: `hasUnsavedChanges` compares JSON, so `getMapForm` below
// must list the same fields in the same order or every dialog opens dirty.
const emptyMapForm: MapCreateInput = {
  name: "",
  gamemode_id: 0,
  in_competitive: true,
  aliases: [],
};

function getMapForm(map: MapRead | null): MapCreateInput | MapUpdateInput {
  if (!map) {
    return { ...emptyMapForm };
  }

  return {
    name: map.name,
    gamemode_id: map.gamemode_id,
    in_competitive: map.in_competitive !== false,
    aliases: map.aliases ?? [],
  };
}

const GAMEMODE_QUERY_PARAM = "gamemode_id";
function parseGamemodeQueryParam(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export default function MapsAdminPage() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { isSuperuser } = usePermissions();
  const formId = useId();
  const nameFieldId = `${formId}-name`;
  const gamemodeFieldId = `${formId}-gamemode`;
  const aliasesFieldId = `${formId}-aliases`;
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingMap, setEditingMap] = useState<MapRead | null>(null);
  const [deletingMap, setDeletingMap] = useState<MapRead | null>(null);
  const [formData, setFormData] = useState<MapCreateInput | MapUpdateInput>({
    ...emptyMapForm,
  });
  const selectedGamemodeId = parseGamemodeQueryParam(searchParams.get(GAMEMODE_QUERY_PARAM));

  const closeForm = () => {
    setCreateDialogOpen(false);
    setEditingMap(null);
    setFormData({ ...emptyMapForm });
  };

  // Fetch gamemodes for selector
  const { data: gamemodesData } = useQuery({
    queryKey: ["gamemodes"],
    queryFn: async () => {
      const response = await apiFetch("/api/v1/gamemodes");
      const data = (await response.json()) as PaginatedResponse<Gamemode>;
      return data.results;
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: MapCreateInput) => adminService.createMap(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "maps"] });
      closeForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: MapUpdateInput }) =>
      adminService.updateMap(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "maps"] });
      closeForm();
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

  const handleGamemodeFilterChange = (value: string) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      nextParams.delete(GAMEMODE_QUERY_PARAM);
    } else {
      nextParams.set(GAMEMODE_QUERY_PARAM, value);
    }
    nextParams.delete("page");

    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const formInitial = getMapForm(editingMap);

  const isFormDirty = (createDialogOpen || !!editingMap) && hasUnsavedChanges(formData, formInitial);
  const columns: ColumnDef<MapRead>[] = [
    {
      accessorKey: "id",
      header: "ID",
      size: 44,
      cell: ({ row }) => <span className="tabular-nums">{row.original.id}</span>,
    },
    {
      id: "image",
      header: () => <div className="text-center">Image</div>,
      size: 96,
      cell: ({ row }) => {
        const map = row.original;
        return (
          <div className="flex justify-center">
            <AssetPreview
              imagePath={map.image_path}
              name={map.name}
              assetLabel="map image"
              className="h-12 w-24"
            />
          </div>
        );
      },
    },
    {
      accessorKey: "name",
      header: "Name",
      size: 144,
    },
    {
      accessorKey: "gamemode",
      header: "Gamemode",
      size: 112,
      enableSorting: false,
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
      accessorKey: "in_competitive",
      header: "Mode Pool",
      size: 120,
      cell: ({ row }) => {
        const map = row.original;
        return map.in_competitive !== false ? (
          <Badge variant="secondary" className="border-success/30 text-success bg-success/10">
            Competitive
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            Casual
          </Badge>
        );
      },
    },
    createAliasesColumn<MapRead>((map) => map.aliases),
    createEntityActionsColumn<MapRead>({
      entityLabel: "map",
      getName: (map) => map.name,
      isSuperuser,
      onEdit: (map) => {
        updateMutation.reset();
        setEditingMap(map);
        setFormData(getMapForm(map));
      },
      onDelete: (map) => setDeletingMap(map),
    }),
  ];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Maps"
        description="Manage game maps"
        actions={
          <CatalogToolbarActions
            canSync={isSuperuser}
            isSyncing={syncMutation.isPending}
            onSync={() => syncMutation.mutate()}
            syncLabel="Sync maps from game"
            onCreate={() => {
              createMutation.reset();
              updateMutation.reset();
              setFormData({ ...emptyMapForm });
              setCreateDialogOpen(true);
            }}
            createLabel="Create map"
          />
        }
      />

      <AdminDataTable
        key={`maps-table-${selectedGamemodeId ?? "all"}`}
        queryKey={(page, search, pageSize, sortField, sortDir) => [
          "admin",
          "maps",
          selectedGamemodeId,
          page,
          search,
          pageSize,
          sortField,
          sortDir,
        ]}
        queryFn={(page, search, pageSize, sortField, sortDir) =>
          adminService.getMaps({
            page,
            search,
            per_page: pageSize,
            gamemode_id: selectedGamemodeId ?? undefined,
            sort: sortField ?? undefined,
            order: sortDir,
          })
        }
        columns={columns}
        searchPlaceholder="Search maps…"
        emptyMessage="No maps yet. Use “Create map” to add the first one."
        actions={
          <Select
            value={selectedGamemodeId?.toString() ?? "all"}
            onValueChange={handleGamemodeFilterChange}
          >
            <SelectTrigger aria-label="Filter maps by gamemode" className="w-[220px]">
              <SelectValue placeholder="Filter by gamemode" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All gamemodes</SelectItem>
              {gamemodesData?.map((gamemode) => (
                <SelectItem key={gamemode.id} value={gamemode.id.toString()}>
                  {gamemode.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        onRowDoubleClick={
          isSuperuser
            ? (row) => {
                const map = row.original;
                updateMutation.reset();
                setEditingMap(map);
                setFormData(getMapForm(map));
              }
            : undefined
        }
      />

      {/* Create/Edit Dialog */}
      <EntityFormDialog
        open={createDialogOpen || !!editingMap}
        onOpenChange={onEntityDialogClose(closeForm)}
        title={editingMap ? "Edit map" : "Create map"}
        description={editingMap ? "Update map information" : "Create a new map in the game"}
        onSubmit={handleSubmit}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        submittingLabel={editingMap ? "Updating map…" : "Creating map…"}
        errorMessage={entityFormError(
          "map",
          !!editingMap,
          updateMutation.error,
          createMutation.error
        )}
        isDirty={isFormDirty}
      >
        <div className="space-y-4">
          <CatalogNameField
            id={nameFieldId}
            value={formData.name}
            onChange={(name) => setFormData({ ...formData, name })}
            placeholder="Map name"
          />

          <div className="space-y-2">
            <Label htmlFor={gamemodeFieldId}>Gamemode *</Label>
            <Select
              value={formData.gamemode_id?.toString() || ""}
              onValueChange={(value) =>
                setFormData({ ...formData, gamemode_id: parseInt(value) })
              }
            >
              <SelectTrigger id={gamemodeFieldId}>
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

          <CatalogAliasesField
            id={aliasesFieldId}
            aliases={formData.aliases}
            onChange={(aliases) => setFormData({ ...formData, aliases })}
            placeholder={"Илиос\nHollywood (Halloween)"}
            helperText="One alias per line — names as they appear in match logs."
          />

          <div className="flex items-center gap-2 pt-2">
            <Checkbox
              id={`${formId}-in-competitive`}
              checked={formData.in_competitive !== false}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, in_competitive: Boolean(checked) })
              }
            />
            <Label htmlFor={`${formId}-in-competitive`} className="cursor-pointer font-medium text-sm">
              Competitive map (Входит в соревновательный пул)
            </Label>
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
          title="Delete map"
          description={`“${deletingMap.name}” will be permanently removed from the map catalogue. This cannot be undone.`}
        />
      )}
    </div>
  );
}
