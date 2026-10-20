"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Palette, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { gameFilterDefs } from "@/components/admin/game-filter";
import { EmptyNote } from "@/components/kit/EmptyNote";
import { EntityFormDialog } from "@/components/kit/EntityFormDialog";
import { FilterBar } from "@/components/kit/FilterBar";
import { InlineEditText } from "@/components/kit/InlineEditText";
import { MasterDetail, MasterList, MasterListSkeleton } from "@/components/kit/MasterDetail";
import { useFilters } from "@/components/kit/useFilters";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageStateCard } from "@/components/ui/page-state-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { GameField } from "@/components/workspace/GameField";
import { GameLabel } from "@/components/workspace/GameLabel";
import { GameScopeGate } from "@/components/workspace/GameScopeGate";
import { useDisciplineMetadata } from "@/hooks/useDisciplineMetadata";
import { useGameDescriptors } from "@/hooks/useGameDescriptors";
import { useGameScope } from "@/hooks/useGameScope";
import { useIsMobile } from "@/hooks/useMobile";
import { usePermissions } from "@/hooks/usePermissions";
import { useQueryParams } from "@/hooks/useQueryParams";
import { useRoleName } from "@/hooks/useRoleName";
import { adminQueryKeys } from "@/lib/admin/query-keys";
import { notify } from "@/lib/notify";
import { ratedDimension, selectableRoles, type RoleOntology } from "@/lib/roster/ontology";
import { disciplineQueryKeys } from "@/lib/site/discipline-query-keys";
import { ALL_DISCIPLINES, defaultCreationGame } from "@/lib/site/discipline-scope";
import { cn } from "@/lib/utils";
import adminService from "@/services/admin.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { PlayerSubRole, PlayerSubRoleUpdateInput } from "@/types/admin.types";
import type { DisciplineDescriptor } from "@/types/discipline.types";

interface RootRole {
  id: number;
  code: string;
  name: string;
}

interface SubRolePermissions {
  edit: boolean;
  deactivate: boolean;
}

const PRESENTATION_KEYS = ["icon", "color"] as const;
type PresentationKey = (typeof PRESENTATION_KEYS)[number];
/** `undefined` inherits from the parent role, `null` is explicitly cleared, a string is its own. */
type Presentation = Record<PresentationKey, string | null | undefined>;

function presentationOf(entry: PlayerSubRole): Presentation {
  const read = (key: PresentationKey) => {
    if (!Object.hasOwn(entry.attrs, key)) return undefined;
    const value = entry.attrs[key];
    return typeof value === "string" ? value : null;
  };
  return { icon: read("icon"), color: read("color") };
}

/**
 * The workspace's sub-role catalog (T4), a multi page (spec §6.11). Filtered to a game: that game's rated roles on the
 * left, the selected role's sub-roles on the right. Unfiltered: every game's sub-roles, grouped by game.
 * Creation is one dialog in both modes (spec §7.2): its game field starts on the filtered game, else the first enabled.
 */
export default function WorkspaceSubRolesSettingsPage() {
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const t = useTranslations("adminSettings.subRoles");
  const gameT = useTranslations("common.discipline");
  const { canAccessPermission } = usePermissions();
  const scope = useGameScope({ axis: workspaceId ?? "all" });
  const { searchParams } = useQueryParams();
  // `?role=` is a role of the filtered game; while a sub-role is open it is that sub-role's (its own game), so it stays.
  const gameDefs = gameFilterDefs(scope.games, gameT("column"), () =>
    searchParams?.has("sub_role") ? [] : ["role"]
  );
  const filters = useFilters(gameDefs);
  const [creating, setCreating] = useState(false);

  if (workspaceId === null) {
    return (
      <PageStateCard
        state="empty"
        title={t("noWorkspace.title")}
        description={t("noWorkspace.description")}
      />
    );
  }
  const games = (scope.games ?? []).filter((entry) => entry.enabled);
  return (
    <GameScopeGate scope={scope}>
      {(game) => (
        <div className="space-y-4">
          <FilterBar
            defs={gameDefs}
            filters={filters}
            trailing={
              canAccessPermission("player.create", workspaceId) ? (
                <Button type="button" onClick={() => setCreating(true)}>
                  <Plus className="mr-1 size-4" aria-hidden />
                  {t("create")}
                </Button>
              ) : undefined
            }
          />
          <SubRoleListing workspaceId={workspaceId} game={game} games={games} />
          {creating ? (
            <CreateSubRoleDialog
              workspaceId={workspaceId}
              games={games}
              game={game}
              onClose={() => setCreating(false)}
            />
          ) : null}
        </div>
      )}
    </GameScopeGate>
  );
}

/** One game's editor: its metadata, then the role → sub-roles catalog. */
function GameSubRoleCatalog({ workspaceId, discipline }: Readonly<{ workspaceId: number; discipline: string }>) {
  const t = useTranslations("adminSettings.subRoles");
  const metadata = useDisciplineMetadata(workspaceId, discipline);
  if (metadata.isError) {
    return <PageStateCard state="error" title={t("errors.load")} onAction={() => void metadata.refetch()} />;
  }
  if (!metadata.data) {
    return (
      <MasterDetail
        list={<MasterListSkeleton />}
        detail={null}
        emptyDetail={
          <div aria-hidden className="space-y-4">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-32" />
          </div>
        }
      />
    );
  }
  return (
    <SubRoleCatalog
      key={`${workspaceId}:${discipline}`}
      workspaceId={workspaceId}
      discipline={discipline}
      ontology={metadata.data}
    />
  );
}

/**
 * The page body. An opened sub-role (`?sub_role=`) is an owner (spec §5) under any game filter: its game's editor.
 * Otherwise the filtered list: one game's editor, or every game's sub-roles grouped by game with its mark (spec §6.11).
 */
function SubRoleListing({
  workspaceId,
  game,
  games
}: Readonly<{ workspaceId: number; game: string | null; games: DisciplineDescriptor[] }>) {
  const t = useTranslations("adminSettings.subRoles");
  const commonT = useTranslations("common");
  const { searchParams, setParams } = useQueryParams({ mode: "push" });
  const openedId = searchParams?.get("sub_role") ?? null;
  // Every game's rows: the all-games list, and the lookup resolving an opened sub-role whatever the scope.
  const needsCatalog = game === null || openedId !== null;
  const catalog = useQuery({
    queryKey: adminQueryKeys.playerSubRolesAll(workspaceId, ALL_DISCIPLINES),
    queryFn: ({ signal }) =>
      adminService.getPlayerSubRoles({ workspace_id: workspaceId, include_inactive: true }, signal),
    enabled: needsCatalog
  });
  const rows = catalog.data ?? [];
  const opened = openedId === null ? undefined : rows.find((entry) => String(entry.id) === openedId);

  if (needsCatalog && catalog.isError) {
    return <PageStateCard state="error" title={t("errors.load")} onAction={() => void catalog.refetch()} />;
  }
  if (opened) {
    return (
      <div className="space-y-4">
        <Button type="button" variant="ghost" size="sm" onClick={() => setParams({ sub_role: null, role: null })}>
          <ArrowLeft className="mr-1 size-4" aria-hidden />
          {game === null ? t("backToAll") : commonT("back")}
        </Button>
        <GameSubRoleCatalog workspaceId={workspaceId} discipline={opened.discipline} />
      </div>
    );
  }
  if (needsCatalog && catalog.isPending) return <Skeleton className="h-64" />;
  // An unknown `?sub_role=` (deleted, another community's) opens nothing: the scoped list stays.
  if (game !== null) return <GameSubRoleCatalog workspaceId={workspaceId} discipline={game} />;
  return (
    <div className="space-y-6">
      {rows.length === 0 ? (
        <EmptyNote>{t("empty")}</EmptyNote>
      ) : (
        games.map((entry) => {
          const entries = rows.filter((row) => row.discipline === entry.code);
          return entries.length === 0 ? null : (
            <GameSubRoleGroup
              key={entry.code}
              workspaceId={workspaceId}
              discipline={entry.code}
              entries={entries}
              onOpen={(row) => setParams({ sub_role: String(row.id), role: row.role })}
            />
          );
        })
      )}
    </div>
  );
}

/** One game's sub-roles in the all-games list: "parent › sub-role", each opening that game's editor. */
function GameSubRoleGroup({
  workspaceId,
  discipline,
  entries,
  onOpen
}: Readonly<{
  workspaceId: number;
  discipline: string;
  entries: PlayerSubRole[];
  onOpen: (entry: PlayerSubRole) => void;
}>) {
  const t = useTranslations("adminSettings.subRoles");
  const nameOf = useRoleName();
  const descriptors = useGameDescriptors();
  const metadata = useDisciplineMetadata(workspaceId, discipline);
  const parents = new Map((metadata.data?.roles ?? []).map((role) => [role.code, nameOf(role)]));
  return (
    <section className="space-y-2">
      <h2 className="text-ui font-semibold text-foreground">
        <GameLabel code={discipline} games={descriptors} />
      </h2>
      <ul className="divide-y divide-border border-y border-border">
        {entries.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              onClick={() => onOpen(entry)}
              className="flex w-full items-center gap-2 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="text-muted-foreground">{parents.get(entry.role) ?? entry.role}</span>
              <span aria-hidden className="text-muted-foreground">
                ›
              </span>
              <span className={cn("min-w-0 flex-1 truncate", !entry.is_active && "text-muted-foreground")}>
                {entry.label}
              </span>
              {entry.is_active ? null : <span className="text-caption text-muted-foreground">{t("inactive")}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Sub-role creation in both list modes (spec §7.2): the game field (the creation default: the filtered game), then a
 * parent among that game's rated roles.
 */
function CreateSubRoleDialog({
  workspaceId,
  games,
  game,
  onClose
}: Readonly<{
  workspaceId: number;
  games: DisciplineDescriptor[];
  /** The list's filtered game, `null` = every game. */
  game: string | null;
  onClose: () => void;
}>) {
  const t = useTranslations("adminSettings.subRoles");
  const roleT = useTranslations("common.roleOntology");
  const nameOf = useRoleName();
  const queryClient = useQueryClient();
  const [discipline, setDiscipline] = useState(() => defaultCreationGame(game, games));
  const [role, setRole] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const metadata = useDisciplineMetadata(workspaceId, discipline);
  const rated = metadata.data ? ratedDimension(metadata.data) : null;
  const roots =
    metadata.data && rated
      ? selectableRoles(metadata.data, rated.code).filter((entry) => entry.parent_id === null)
      : [];
  const create = useMutation({
    mutationFn: () =>
      adminService.createPlayerSubRole({
        workspace_id: workspaceId,
        discipline: discipline!,
        role: role!,
        label: label.trim()
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminQueryKeys.playerSubRoles(workspaceId) }),
        queryClient.invalidateQueries({ queryKey: adminQueryKeys.playerSubRolesPublic(workspaceId, discipline) }),
        queryClient.invalidateQueries({ queryKey: disciplineQueryKeys.metadata(workspaceId, discipline!) })
      ]);
      notify.success(t("toast.added"));
      onClose();
    },
    onError: (error) => notify.apiError(error, { title: t("errors.add") })
  });
  const ready = discipline !== null && role !== null && label.trim() !== "";

  return (
    <EntityFormDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("create")}
      isDirty={role !== null || label.trim() !== ""}
      isSubmitting={create.isPending}
      onSubmit={() => {
        if (ready) create.mutate();
      }}
    >
      <GameField
        id="sub-role-game"
        games={games}
        value={discipline}
        onChange={(code) => {
          setDiscipline(code);
          setRole(null);
        }}
      />
      <div className="space-y-1.5">
        <Label id="sub-role-parent-label">{t("parentRole")}</Label>
        {/* A game whose roles did not load offers no parent: say so, rather than an empty picker. */}
        {metadata.isError || (metadata.data && !rated) ? (
          <PageStateCard
            state="error"
            title={roleT("metadataError")}
            onAction={metadata.isError ? () => void metadata.refetch() : undefined}
          />
        ) : (
          <ToggleGroup
            type="single"
            variant="pill"
            size="sm"
            aria-labelledby="sub-role-parent-label"
            value={role ?? ""}
            onValueChange={(value) => setRole(value || null)}
          >
            {roots.map((entry) => (
              <ToggleGroupItem key={entry.id} value={entry.code}>
                {nameOf(entry)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sub-role-label">{t("labelField")}</Label>
        <Input id="sub-role-label" value={label} onChange={(event) => setLabel(event.target.value)} />
      </div>
    </EntityFormDialog>
  );
}

/**
 * `?role=` is the selection, written with `mode: "push"`: below `md`
 * `MasterDetail` shows the list or the role, and its Back is `history.back()`.
 * For the same reason only a wide viewport opens the first role implicitly.
 */
function SubRoleCatalog({
  workspaceId,
  discipline,
  ontology
}: Readonly<{ workspaceId: number; discipline: string; ontology: RoleOntology }>) {
  const t = useTranslations("adminSettings.subRoles");
  const roleT = useTranslations("common.roleOntology");
  const nameOf = useRoleName();
  const isMobile = useIsMobile();
  const { searchParams, setParams } = useQueryParams({ mode: "push" });
  const { canAccessPermission } = usePermissions();
  const rated = ratedDimension(ontology);
  const roots: RootRole[] = rated
    ? selectableRoles(ontology, rated.code)
        .filter((role) => role.parent_id === null)
        .map((role) => ({ id: role.id, code: role.code, name: nameOf(role) }))
    : [];
  const permissions: SubRolePermissions = {
    edit: canAccessPermission("player.update", workspaceId),
    deactivate: canAccessPermission("player.delete", workspaceId)
  };
  const catalog = useQuery({
    queryKey: adminQueryKeys.playerSubRolesAll(workspaceId, discipline),
    queryFn: ({ signal }) =>
      adminService.getPlayerSubRoles(
        { workspace_id: workspaceId, discipline, include_inactive: true },
        signal
      )
  });

  if (!rated) return <PageStateCard state="error" title={roleT("metadataError")} />;
  if (catalog.isError) {
    return (
      <PageStateCard
        state="error"
        title={t("errors.load")}
        onAction={() => void catalog.refetch()}
      />
    );
  }

  const selected =
    roots.find((role) => role.code === searchParams?.get("role")) ??
    (isMobile ? null : (roots[0] ?? null));

  return (
    <MasterDetail
      list={
        <MasterList
          label={t("rolesLabel")}
          items={roots.map((role) => ({
            key: role.code,
            label: role.name,
            icon: (
              <PlayerRoleIcon
                role={{ dimension: rated.code, role: role.code }}
                ontology={ontology}
                size={16}
                decorative
              />
            )
          }))}
          selectedKey={selected?.code}
          onSelect={(roleCode) => setParams({ role: roleCode })}
        />
      }
      detail={
        selected ? (
          <RoleSubRoles
            key={selected.code}
            workspaceId={workspaceId}
            discipline={discipline}
            dimension={rated.code}
            ontology={ontology}
            role={selected}
            loading={catalog.isLoading}
            entries={(catalog.data ?? []).filter(
              (row) =>
                row.discipline === discipline &&
                row.dimension === rated.code &&
                row.role === selected.code
            )}
            permissions={permissions}
          />
        ) : null
      }
    />
  );
}

function RoleSubRoles({
  workspaceId,
  discipline,
  dimension,
  ontology,
  role,
  loading,
  entries,
  permissions
}: Readonly<{
  workspaceId: number;
  discipline: string;
  dimension: string;
  ontology: RoleOntology;
  role: RootRole;
  loading: boolean;
  entries: PlayerSubRole[];
  permissions: SubRolePermissions;
}>) {
  const t = useTranslations("adminSettings.subRoles");
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<PlayerSubRole | null>(null);

  const invalidate = async () => {
    await Promise.all([
      // Every game's list shows this game's rows too: drop the workspace's sub-role lists, not one game's.
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.playerSubRoles(workspaceId) }),
      queryClient.invalidateQueries({
        queryKey: adminQueryKeys.playerSubRolesPublic(workspaceId, discipline)
      }),
      queryClient.invalidateQueries({ queryKey: disciplineQueryKeys.metadata(workspaceId, discipline) })
    ]);
  };
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: PlayerSubRoleUpdateInput }) =>
      adminService.updatePlayerSubRole(id, patch),
    onSuccess: invalidate,
    onError: (error) => notify.apiError(error, { title: t("errors.update") })
  });
  const deactivate = useMutation({
    mutationFn: (id: number) => adminService.deletePlayerSubRole(id),
    onSuccess: invalidate,
    onError: (error) => notify.apiError(error, { title: t("errors.update") })
  });
  const busy = update.isPending || deactivate.isPending;

  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 text-ui font-semibold text-foreground">
        <PlayerRoleIcon
          role={{ dimension, role: role.code }}
          ontology={ontology}
          size={20}
          decorative
        />
        {role.name}
      </h2>

      {loading ? (
        <Skeleton className="h-32" />
      ) : entries.length === 0 ? (
        <EmptyNote>{t("empty")}</EmptyNote>
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {entries.map((entry) => (
            <SubRoleRow
              key={entry.id}
              entry={entry}
              roleName={role.name}
              permissions={permissions}
              busy={busy}
              onRename={(label) => update.mutateAsync({ id: entry.id, patch: { label } })}
              onToggle={(active) =>
                active
                  ? update.mutate({ id: entry.id, patch: { is_active: true } })
                  : deactivate.mutate(entry.id)
              }
              onEditPresentation={() => setEditing(entry)}
            />
          ))}
        </ul>
      )}

      {editing ? (
        <PresentationDialog
          entry={editing}
          saving={update.isPending}
          onClose={() => setEditing(null)}
          onSave={(patch) =>
            update.mutate({ id: editing.id, patch }, { onSuccess: () => setEditing(null) })
          }
        />
      ) : null}
    </section>
  );
}

function SubRoleRow({
  entry,
  roleName,
  permissions,
  busy,
  onRename,
  onToggle,
  onEditPresentation
}: Readonly<{
  entry: PlayerSubRole;
  roleName: string;
  permissions: SubRolePermissions;
  busy: boolean;
  onRename: (label: string) => Promise<unknown>;
  onToggle: (active: boolean) => void;
  onEditPresentation: () => void;
}>) {
  const t = useTranslations("adminSettings.subRoles");
  // Deactivating and restoring are gated separately; whichever the reader may
  // not do is absent, and an inactive row then says so in words.
  const canToggle = entry.is_active ? permissions.deactivate : permissions.edit;

  return (
    <li className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <InlineEditText
          value={entry.label}
          label={t("nameLabel", { role: roleName })}
          canEdit={permissions.edit && !busy}
          onSave={onRename}
          textClassName={entry.is_active ? undefined : "text-muted-foreground"}
        />
      </div>
      {permissions.edit ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("presentation", { name: entry.label })}
          title={t("presentation", { name: entry.label })}
          onClick={onEditPresentation}
        >
          <Palette className="size-4" aria-hidden />
        </Button>
      ) : null}
      {canToggle ? (
        <Switch
          checked={entry.is_active}
          disabled={busy}
          aria-label={
            entry.is_active
              ? t("deactivate", { name: entry.label })
              : t("restore", { name: entry.label })
          }
          onCheckedChange={onToggle}
        />
      ) : entry.is_active ? null : (
        <span className="text-caption text-muted-foreground">{t("inactive")}</span>
      )}
    </li>
  );
}

/** Icon and colour of one sub-role: each inherits, is its own, or is explicitly cleared. */
function PresentationDialog({
  entry,
  saving,
  onClose,
  onSave
}: Readonly<{
  entry: PlayerSubRole;
  saving: boolean;
  onClose: () => void;
  onSave: (patch: PlayerSubRoleUpdateInput) => void;
}>) {
  const t = useTranslations("adminSettings.subRoles");
  const roleT = useTranslations("common.roleOntology");
  const [initial] = useState(() => presentationOf(entry));
  const [form, setForm] = useState(initial);

  const patch: PlayerSubRoleUpdateInput = {};
  for (const key of PRESENTATION_KEYS) {
    const value = form[key];
    if (value !== initial[key]) patch[key] = value?.trim() || null;
  }
  const dirty = Object.keys(patch).length > 0;

  return (
    <EntityFormDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("presentation", { name: entry.label })}
      isDirty={dirty}
      isSubmitting={saving}
      onSubmit={() => (dirty ? onSave(patch) : onClose())}
    >
      {PRESENTATION_KEYS.map((key) => {
        const value = form[key];
        const state = value === undefined ? "inherits" : value?.trim() ? "override" : "cleared";
        return (
          <div key={key} className="space-y-1.5">
            <Label htmlFor={`sub-role-${entry.id}-${key}`}>{roleT(key)}</Label>
            <div className="flex gap-2">
              <Input
                id={`sub-role-${entry.id}-${key}`}
                value={value ?? ""}
                onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
              />
              {state === "cleared" ? null : (
                <Button
                  type="button"
                  variant="outline"
                  aria-label={roleT("clearPresentation", { field: roleT(key), role: entry.label })}
                  onClick={() => setForm((current) => ({ ...current, [key]: null }))}
                >
                  {roleT("clearOverride")}
                </Button>
              )}
            </div>
            <p className="text-caption text-muted-foreground">{roleT(state)}</p>
          </div>
        );
      })}
    </EntityFormDialog>
  );
}
