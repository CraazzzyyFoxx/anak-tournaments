"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Palette, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { EntityFormDialog } from "@/components/kit/EntityFormDialog";
import { InlineEditText } from "@/components/kit/InlineEditText";
import { MasterDetail } from "@/components/kit/MasterDetail";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageStateCard } from "@/components/ui/page-state-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { GameScopeControl } from "@/components/workspace/GameScopeControl";
import { useGameScope } from "@/hooks/useGameScope";
import { useDisciplineMetadata } from "@/hooks/useDisciplineMetadata";
import { useIsMobile } from "@/hooks/useMobile";
import { usePermissions } from "@/hooks/usePermissions";
import { useQueryParams } from "@/hooks/useQueryParams";
import { useRoleName } from "@/hooks/useRoleName";
import { adminQueryKeys } from "@/lib/admin/query-keys";
import { notify } from "@/lib/notify";
import { ratedDimension, selectableRoles, type RoleOntology } from "@/lib/roster/ontology";
import { disciplineQueryKeys } from "@/lib/site/discipline-query-keys";
import { cn } from "@/lib/utils";
import adminService from "@/services/admin.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { PlayerSubRole, PlayerSubRoleUpdateInput } from "@/types/admin.types";

interface RootRole {
  id: number;
  code: string;
  name: string;
}

interface SubRolePermissions {
  edit: boolean;
  create: boolean;
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
 * The workspace's sub-role catalog (T4): the rated dimension's top-level roles
 * on the left, the selected role's sub-roles on the right.
 */
export default function WorkspaceSubRolesSettingsPage() {
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const t = useTranslations("adminSettings.subRoles");
  const scope = useGameScope({ pageClass: "single", axis: workspaceId ?? "all" });
  const code = scope.game;
  const metadata = useDisciplineMetadata(scope.axis, code);

  if (workspaceId === null) {
    return (
      <PageStateCard
        state="empty"
        title={t("noWorkspace.title")}
        description={t("noWorkspace.description")}
      />
    );
  }
  if (scope.resolution?.game.kind === "invalid" || scope.resolution?.game.kind === "empty") {
    return <GameScopeControl scope={scope} variant="single" />;
  }
  if (scope.isError || metadata.isError) {
    return (
      <PageStateCard
        state="error"
        title={t("errors.load")}
        onAction={() => {
          scope.refetch();
          if (code) void metadata.refetch();
        }}
      />
    );
  }
  if (!metadata.data || !code || typeof scope.axis !== "number") {
    return <Skeleton className="h-64" />;
  }

  return (
    <div className="space-y-4">
      <GameScopeControl scope={scope} variant="single" />
      <SubRoleCatalog
        key={`${scope.axis}:${code}`}
        workspaceId={scope.axis}
        discipline={code}
        ontology={metadata.data}
      />
    </div>
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
    create: canAccessPermission("player.create", workspaceId),
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
      listWidth={240}
      list={
        <nav aria-label={t("rolesLabel")} className="rounded-xl border border-border bg-card p-2">
          <ul className="flex flex-col gap-0.5">
            {roots.map((role) => {
              const isSelected = role.code === selected?.code;
              return (
                <li key={role.id}>
                  <button
                    type="button"
                    aria-current={isSelected ? "true" : undefined}
                    onClick={() => setParams({ role: role.code })}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isSelected
                        ? "bg-accent/40 font-medium text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <PlayerRoleIcon
                      role={{ dimension: rated.code, role: role.code }}
                      ontology={ontology}
                      size={16}
                      decorative
                    />
                    <span className="min-w-0 flex-1 truncate">{role.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
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
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<PlayerSubRole | null>(null);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.playerSubRoles(workspaceId, discipline) }),
      queryClient.invalidateQueries({
        queryKey: adminQueryKeys.playerSubRolesPublic(workspaceId, discipline)
      }),
      queryClient.invalidateQueries({ queryKey: disciplineQueryKeys.metadata(workspaceId, discipline) })
    ]);
  };
  const create = useMutation({
    mutationFn: (label: string) =>
      adminService.createPlayerSubRole({ workspace_id: workspaceId, discipline, role: role.code, label }),
    onSuccess: async () => {
      setDraft("");
      await invalidate();
      notify.success(t("toast.added"));
    },
    onError: (error) => notify.apiError(error, { title: t("errors.add") })
  });
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
  const busy = create.isPending || update.isPending || deactivate.isPending;
  const add = () => {
    const label = draft.trim();
    if (label) create.mutate(label);
  };

  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <PlayerRoleIcon role={{ dimension, role: role.code }} ontology={ontology} size={20} decorative />
        {role.name}
      </h2>

      {loading ? (
        <Skeleton className="h-32" />
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
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

      {permissions.create ? (
        <div className="flex gap-2">
          <Input
            aria-label={t("nameLabel", { role: role.name })}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
            placeholder={t("addPlaceholder", { role: role.name })}
          />
          <Button type="button" variant="outline" disabled={busy || !draft.trim()} onClick={add}>
            <Plus className="mr-1 size-4" aria-hidden />
            {t("add")}
          </Button>
        </div>
      ) : null}

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
