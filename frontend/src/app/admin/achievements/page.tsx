"use client";

import { useMemo, useRef, useEffect, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import {
  MoreHorizontal,
  Plus,
  Pencil,
  Trash2,
  Play,
  Square,
  Check,
  X,
  Loader2,
  ChevronDown,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { EntityFormDialog } from "@/components/admin/EntityFormDialog";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

import adminService from "@/services/admin.service";
import TournamentService from "@/services/tournament.service";
import type { Achievement } from "@/types/achievement.types";
import type {
  AchievementCreateInput,
  AchievementUpdateInput,
  AchievementRegistryEntry,
} from "@/types/admin.types";
import type { Tournament } from "@/types/tournament.types";
import { usePermissions } from "@/hooks/usePermissions";
import { hasUnsavedChanges } from "@/lib/form-change";
import { useAchievementCalculationStream } from "@/hooks/useAchievementCalculationStream";
import { useCurrentWorkspaceId } from "@/hooks/useCurrentWorkspace";

// ─── Constants ──────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  overall: "Overall",
  hero: "Hero",
  division: "Division",
  team: "Team",
  standing: "Standing",
  match: "Match",
};

const emptyForm: AchievementCreateInput = {
  name: "",
  slug: "",
  description_ru: "",
  description_en: "",
  image_url: null,
  hero_id: null,
};

function getAchievementForm(
  achievement: Achievement | null,
): AchievementCreateInput | AchievementUpdateInput {
  if (!achievement) return { ...emptyForm };
  return {
    name: achievement.name,
    slug: achievement.slug,
    description_ru: achievement.description_ru,
    description_en: achievement.description_en,
    image_url: achievement.image_url,
    hero_id: null,
  };
}

// ─── Calculation Panel ──────────────────────────────────────────────────────

function CalculationPanel() {
  const { state, start, stop } = useAchievementCalculationStream();
  const workspaceId = useCurrentWorkspaceId();
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set());
  const [selectedTournamentId, setSelectedTournamentId] = useState<
    number | undefined
  >(undefined);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Fetch registry
  const { data: registryData } = useQuery({
    queryKey: ["admin", "achievements", "registry"],
    queryFn: () => adminService.getAchievementRegistry(),
  });

  // Fetch tournaments for selector
  const { data: tournamentsData } = useQuery({
    queryKey: ["tournaments", "all"],
    queryFn: () => TournamentService.getAll(null),
  });

  const tournaments: Tournament[] = tournamentsData?.results ?? [];

  // Group registry entries by category
  const grouped = useMemo(() => {
    if (!registryData?.entries) return new Map<string, AchievementRegistryEntry[]>();
    const map = new Map<string, AchievementRegistryEntry[]>();
    for (const entry of registryData.entries) {
      const list = map.get(entry.category) ?? [];
      list.push(entry);
      map.set(entry.category, list);
    }
    return map;
  }, [registryData]);

  const allSlugs = useMemo(
    () => registryData?.entries.map((e) => e.slug) ?? [],
    [registryData],
  );

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.logs]);

  const toggleSlug = (slug: string) => {
    setSelectedSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const toggleCategory = (category: string) => {
    const categorySlugs = grouped.get(category)?.map((e) => e.slug) ?? [];
    const allSelected = categorySlugs.every((s) => selectedSlugs.has(s));
    setSelectedSlugs((prev) => {
      const next = new Set(prev);
      for (const slug of categorySlugs) {
        if (allSelected) next.delete(slug);
        else next.add(slug);
      }
      return next;
    });
  };

  const selectAll = () => setSelectedSlugs(new Set(allSlugs));
  const deselectAll = () => setSelectedSlugs(new Set());

  const handleCalculate = () => {
    const slugs = selectedSlugs.size > 0 && selectedSlugs.size < allSlugs.length
      ? Array.from(selectedSlugs)
      : undefined;
    start(slugs, selectedTournamentId, workspaceId);
  };

  const progressPercent =
    state.progress && state.progress.total > 0
      ? Math.round((state.progress.current / state.progress.total) * 100)
      : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Calculate Achievements</CardTitle>
        <CardDescription>
          Select achievements to calculate and optionally scope to a specific tournament.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Tournament selector */}
        <div className="space-y-2">
          <Label>Tournament (optional)</Label>
          <Select
            value={selectedTournamentId !== undefined ? String(selectedTournamentId) : "all"}
            onValueChange={(val) =>
              setSelectedTournamentId(val === "all" ? undefined : Number(val))
            }
          >
            <SelectTrigger className="w-full max-w-sm">
              <SelectValue placeholder="All tournaments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tournaments</SelectItem>
              {tournaments.map((t) => (
                <SelectItem key={t.id} value={String(t.id)}>
                  #{t.id} — {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Slug selection */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Achievements to calculate</Label>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={selectAll} disabled={state.running}>
                Select All
              </Button>
              <Button variant="outline" size="sm" onClick={deselectAll} disabled={state.running}>
                Deselect All
              </Button>
            </div>
          </div>

          {selectedSlugs.size > 0 && (
            <p className="text-sm text-muted-foreground">
              {selectedSlugs.size} of {allSlugs.length} selected
              {selectedSlugs.size === allSlugs.length && " (all)"}
            </p>
          )}

          <div className="space-y-1">
            {Array.from(grouped.entries()).map(([category, entries]) => {
              const categorySlugs = entries.map((e) => e.slug);
              const selectedCount = categorySlugs.filter((s) =>
                selectedSlugs.has(s),
              ).length;
              const allCategorySelected = selectedCount === categorySlugs.length;
              const someSelected = selectedCount > 0;

              return (
                <Collapsible key={category}>
                  <div className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
                    <Checkbox
                      checked={allCategorySelected ? true : someSelected ? "indeterminate" : false}
                      onCheckedChange={() => toggleCategory(category)}
                      disabled={state.running}
                    />
                    <CollapsibleTrigger className="flex flex-1 items-center justify-between text-sm font-medium">
                      <span>
                        {CATEGORY_LABELS[category] ?? category}
                        <span className="ml-2 text-muted-foreground font-normal">
                          ({selectedCount}/{entries.length})
                        </span>
                      </span>
                      <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform [[data-state=open]>&]:rotate-180" />
                    </CollapsibleTrigger>
                  </div>
                  <CollapsibleContent>
                    <div className="grid grid-cols-2 gap-1 pl-8 pb-2 sm:grid-cols-3 lg:grid-cols-4">
                      {entries.map((entry) => (
                        <label
                          key={entry.slug}
                          className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/30 cursor-pointer"
                        >
                          <Checkbox
                            checked={selectedSlugs.has(entry.slug)}
                            onCheckedChange={() => toggleSlug(entry.slug)}
                            disabled={state.running}
                          />
                          <span className="truncate">{entry.slug}</span>
                          {entry.tournament_required && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">
                              T
                            </Badge>
                          )}
                        </label>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <Button
            onClick={handleCalculate}
            disabled={state.running}
          >
            {state.running ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Calculating...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                Calculate
              </>
            )}
          </Button>
          {state.running && (
            <Button variant="outline" onClick={stop}>
              <Square className="mr-2 h-4 w-4" />
              Stop
            </Button>
          )}
        </div>

        {/* Progress */}
        {state.progress && state.progress.total > 0 && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>
                {state.progress.current} / {state.progress.total}
              </span>
              <span>{progressPercent}%</span>
            </div>
            <Progress value={progressPercent} />
          </div>
        )}

        {/* Log output */}
        {state.logs.length > 0 && (
          <div className="space-y-2">
            <Label>Calculation Log</Label>
            <ScrollArea className="h-64 rounded-md border bg-muted/20 p-3">
              <div className="space-y-1 font-mono text-xs">
                {state.logs.map((log, i) => (
                  <div key={i} className="flex items-start gap-2">
                    {log.type === "progress" && log.status === "running" && (
                      <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin text-blue-500" />
                    )}
                    {log.type === "progress" && log.status === "done" && (
                      <Check className="mt-0.5 h-3 w-3 shrink-0 text-green-500" />
                    )}
                    {log.type === "progress" && log.status === "error" && (
                      <X className="mt-0.5 h-3 w-3 shrink-0 text-red-500" />
                    )}
                    {log.type === "start" && (
                      <Play className="mt-0.5 h-3 w-3 shrink-0 text-blue-500" />
                    )}
                    {log.type === "info" && (
                      <Check className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                    )}
                    {log.type === "complete" && (
                      <Check className="mt-0.5 h-3 w-3 shrink-0 text-green-500" />
                    )}
                    {log.type === "error" && !log.slug && (
                      <X className="mt-0.5 h-3 w-3 shrink-0 text-red-500" />
                    )}
                    <span className="text-muted-foreground break-all">
                      {log.type === "start" && `Starting calculation of ${log.total} achievements...`}
                      {log.type === "info" && log.message}
                      {log.type === "progress" &&
                        `[${(log.index ?? 0) + 1}/${log.total}] ${log.slug} — ${log.status}${log.message ? `: ${log.message}` : ""}`}
                      {log.type === "complete" &&
                        `Done. ${log.executed?.length ?? 0} of ${log.total} executed successfully.`}
                      {log.type === "error" && !log.slug && (log.message ?? "Error")}
                    </span>
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            </ScrollArea>
          </div>
        )}

        {state.error && !state.running && (
          <p className="text-sm text-destructive">{state.error}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function AchievementsAdminPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingAchievement, setEditingAchievement] = useState<Achievement | null>(null);
  const [deletingAchievement, setDeletingAchievement] = useState<Achievement | null>(null);
  const [formData, setFormData] = useState<AchievementCreateInput | AchievementUpdateInput>({
    ...emptyForm,
  });

  const canCreate = hasPermission("achievement.create");
  const canUpdate = hasPermission("achievement.update");
  const canDelete = hasPermission("achievement.delete");

  const createMutation = useMutation({
    mutationFn: (data: AchievementCreateInput) => adminService.createAchievement(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "achievements"] });
      setCreateDialogOpen(false);
      setFormData({ ...emptyForm });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: AchievementUpdateInput }) =>
      adminService.updateAchievement(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "achievements"] });
      setEditingAchievement(null);
      setFormData({ ...emptyForm });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminService.deleteAchievement(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "achievements"] });
      setDeletingAchievement(null);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingAchievement) {
      updateMutation.mutate({
        id: editingAchievement.id,
        data: formData as AchievementUpdateInput,
      });
    } else {
      createMutation.mutate(formData as AchievementCreateInput);
    }
  };

  const formInitial = getAchievementForm(editingAchievement);
  const isFormDirty =
    (createDialogOpen || !!editingAchievement) &&
    hasUnsavedChanges(formData, formInitial);

  const columns: ColumnDef<Achievement>[] = [
    {
      accessorKey: "id",
      header: "ID",
      size: 50,
    },
    {
      accessorKey: "name",
      header: "Name",
      size: 180,
    },
    {
      accessorKey: "slug",
      header: "Slug",
      size: 160,
      cell: ({ row }) => (
        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
          {row.original.slug}
        </code>
      ),
    },
    {
      accessorKey: "description_en",
      header: "Description",
      size: 280,
      cell: ({ row }) => (
        <span className="text-muted-foreground truncate block max-w-70">
          {row.original.description_en}
        </span>
      ),
    },
    {
      id: "actions",
      size: 50,
      cell: ({ row }) => {
        const achievement = row.original;
        if (!canUpdate && !canDelete) return null;

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={`Open actions for ${achievement.name}`}
                variant="ghost"
                size="icon"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              {canUpdate ? (
                <DropdownMenuItem
                  onClick={() => {
                    updateMutation.reset();
                    setEditingAchievement(achievement);
                    setFormData(getAchievementForm(achievement));
                  }}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
              ) : null}
              {canUpdate && canDelete ? <DropdownMenuSeparator /> : null}
              {canDelete ? (
                <DropdownMenuItem
                  onClick={() => setDeletingAchievement(achievement)}
                  className="text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Achievements"
        description="Manage achievement definitions and trigger calculations"
        actions={
          canCreate ? (
            <Button
              onClick={() => {
                createMutation.reset();
                updateMutation.reset();
                setFormData({ ...emptyForm });
                setCreateDialogOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Create Achievement
            </Button>
          ) : null
        }
      />

      <AdminDataTable
        queryKey={(page, search, pageSize, sortField, sortDir) => [
          "admin",
          "achievements",
          page,
          search,
          pageSize,
          sortField,
          sortDir,
        ]}
        queryFn={(page, search, pageSize, sortField, sortDir) =>
          adminService.getAchievements({
            page,
            search: search || undefined,
            per_page: pageSize,
            sort: sortField ?? undefined,
            order: sortDir,
          })
        }
        columns={columns}
        searchPlaceholder="Search achievements..."
        emptyMessage="No achievements found."
        onRowDoubleClick={
          canUpdate
            ? (row) => {
                const achievement = row.original;
                updateMutation.reset();
                setEditingAchievement(achievement);
                setFormData(getAchievementForm(achievement));
              }
            : undefined
        }
      />

      {/* Create/Edit Dialog */}
      <EntityFormDialog
        open={createDialogOpen || !!editingAchievement}
        onOpenChange={(open) => {
          if (!open) {
            setCreateDialogOpen(false);
            setEditingAchievement(null);
            setFormData({ ...emptyForm });
          }
        }}
        title={editingAchievement ? "Edit Achievement" : "Create Achievement"}
        description={
          editingAchievement
            ? "Update achievement information"
            : "Create a new achievement definition"
        }
        onSubmit={handleSubmit}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        submittingLabel={
          editingAchievement ? "Updating achievement..." : "Creating achievement..."
        }
        errorMessage={
          (editingAchievement ? updateMutation.error : createMutation.error) instanceof Error
            ? (editingAchievement ? updateMutation.error : createMutation.error)?.message
            : undefined
        }
        isDirty={isFormDirty}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={formData.name ?? ""}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Achievement name"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="slug">Slug</Label>
            <Input
              id="slug"
              value={(formData as AchievementCreateInput).slug ?? ""}
              onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
              placeholder="achievement-slug"
              required={!editingAchievement}
            />
            <p className="text-xs text-muted-foreground">
              Unique identifier used in the calculation registry.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description_ru">Description (RU)</Label>
            <Input
              id="description_ru"
              value={(formData as AchievementCreateInput).description_ru ?? ""}
              onChange={(e) =>
                setFormData({ ...formData, description_ru: e.target.value })
              }
              placeholder="Описание достижения"
              required={!editingAchievement}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description_en">Description (EN)</Label>
            <Input
              id="description_en"
              value={(formData as AchievementCreateInput).description_en ?? ""}
              onChange={(e) =>
                setFormData({ ...formData, description_en: e.target.value })
              }
              placeholder="Achievement description"
              required={!editingAchievement}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="image_url">Image URL (optional)</Label>
            <Input
              id="image_url"
              type="url"
              value={formData.image_url ?? ""}
              onChange={(e) =>
                setFormData({ ...formData, image_url: e.target.value || null })
              }
              placeholder="https://example.com/achievement.png"
            />
          </div>
        </div>
      </EntityFormDialog>

      {/* Delete Confirmation */}
      {canDelete && deletingAchievement && (
        <DeleteConfirmDialog
          open={!!deletingAchievement}
          onOpenChange={(open) => !open && setDeletingAchievement(null)}
          onConfirm={() => deleteMutation.mutate(deletingAchievement.id)}
          isDeleting={deleteMutation.isPending}
          title={`Delete "${deletingAchievement.name}"?`}
        />
      )}

      {/* Calculation Panel */}
      <CalculationPanel />
    </div>
  );
}
