"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { InlineEditText } from "@/components/kit/InlineEditText";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageStateCard } from "@/components/ui/page-state-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { DisciplineSelector, DisciplineUnavailable } from "@/components/workspace/DisciplineSelector";
import { useBrowsingDiscipline } from "@/hooks/useBrowsingDiscipline";
import { useDisciplineMetadata } from "@/hooks/useDisciplineMetadata";
import { usePermissions } from "@/hooks/usePermissions";
import { notify } from "@/lib/notify";
import { ratedDimension, selectableRoles, type RoleOntology } from "@/lib/roster/ontology";
import { disciplineQueryKeys } from "@/lib/site/discipline-query-keys";
import adminService from "@/services/admin.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { PlayerSubRoleUpdateInput } from "@/types/admin.types";
import { adminQueryKeys } from "@/lib/admin/query-keys";

export default function WorkspaceSubRolesSettingsPage() {
  const workspaceId = useWorkspaceStore(state => state.currentWorkspaceId);
  const t = useTranslations("adminSettings.subRoles");
  const scope = useBrowsingDiscipline({ allowsAll: false, axis: workspaceId ?? "all" });
  const code = scope.resolved?.kind === "concrete" ? scope.resolved.code : null;
  const metadata = useDisciplineMetadata(scope.axis, code);
  if (workspaceId === null) return <PageStateCard state="empty" title={t("noWorkspace.title")} description={t("noWorkspace.description")} />;
  if (scope.resolved?.kind === "invalid" || scope.resolved?.kind === "empty") return <DisciplineUnavailable resolved={scope.resolved} disciplines={scope.disciplines ?? []} allowsAll={false} onSelect={scope.select} />;
  if (scope.isError || metadata.isError) return <PageStateCard state="error" title={t("errors.update")} onAction={() => { scope.refetch(); if (code) void metadata.refetch(); }} />;
  if (!metadata.data || !code || typeof scope.axis !== "number") return <Skeleton className="h-64" />;
  return <div className="space-y-4">
    <DisciplineSelector disciplines={scope.disciplines ?? []} value={code} allowsAll={false} onSelect={scope.select} />
    <SubRoleCatalog key={`${scope.axis}:${code}`} workspaceId={scope.axis} discipline={code} ontology={metadata.data} />
  </div>;
}

function SubRoleCatalog({ workspaceId, discipline, ontology }: Readonly<{ workspaceId: number; discipline: string; ontology: RoleOntology }>) {
  const t = useTranslations("adminSettings.subRoles");
  const roleT = useTranslations("common.roleOntology");
  const { canAccessPermission } = usePermissions();
  const queryClient = useQueryClient();
  const [draftLabels, setDraftLabels] = useState<Record<string, string>>({});
  const rated = ratedDimension(ontology);
  const roots = rated ? selectableRoles(ontology, rated.code).filter(role => role.parent_id === null) : [];
  const canEdit = canAccessPermission("player.update", workspaceId);
  const canCreate = canAccessPermission("player.create", workspaceId);
  const canDeactivate = canAccessPermission("player.delete", workspaceId);
  const catalog = useQuery({
    queryKey: adminQueryKeys.playerSubRolesAll(workspaceId, discipline),
    queryFn: ({ signal }) => adminService.getPlayerSubRoles({ workspace_id: workspaceId, discipline, include_inactive: true }, signal)
  });
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.playerSubRoles(workspaceId, discipline) }),
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.playerSubRolesPublic(workspaceId, discipline) }),
      queryClient.invalidateQueries({ queryKey: disciplineQueryKeys.metadata(workspaceId, discipline) })
    ]);
  };
  const create = useMutation({
    mutationFn: ({ role, label }: { role: string; label: string }) => adminService.createPlayerSubRole({ workspace_id: workspaceId, discipline, role, label }),
    onSuccess: async (_, { role }) => { setDraftLabels(prev => ({ ...prev, [role]: "" })); await invalidate(); notify.success(t("toast.added")); },
    onError: error => notify.apiError(error, { title: t("errors.add") })
  });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: PlayerSubRoleUpdateInput }) => adminService.updatePlayerSubRole(id, patch),
    onSuccess: invalidate,
    onError: error => notify.apiError(error, { title: t("errors.update") })
  });
  const deactivate = useMutation({
    mutationFn: (id: number) => adminService.deletePlayerSubRole(id), onSuccess: invalidate,
    onError: error => notify.apiError(error, { title: t("errors.update") })
  });
  if (!rated) return <p role="alert">{roleT("metadataError")}</p>;
  if (catalog.isError) return <PageStateCard state="error" title={t("errors.update")} onAction={() => void catalog.refetch()} />;
  const busy = create.isPending || update.isPending || deactivate.isPending;
  return <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
    {roots.map(role => {
      const entries = (catalog.data ?? []).filter(row => row.discipline === discipline && row.dimension === rated.code && row.role === role.code);
      const draft = draftLabels[role.code] ?? "";
      const add = () => { if (draft.trim()) create.mutate({ role: role.code, label: draft.trim() }); };
      return <Card key={role.id}><CardHeader><CardTitle asChild><h2 className="flex items-center gap-2"><PlayerRoleIcon role={{ dimension: rated.code, role: role.code }} ontology={ontology} size={20} decorative />{role.name}</h2></CardTitle>
        <CardDescription>{entries.length ? t("activeCount", { active: entries.filter(row => row.is_active).length, total: entries.length }) : t("empty")}</CardDescription></CardHeader>
        <CardContent className="space-y-3">{catalog.isLoading ? <Skeleton className="h-32" /> : <ul className="space-y-3">{entries.map(entry => <li key={entry.id} className="space-y-2 rounded-md border p-2">
          <div className="flex items-center gap-2"><InlineEditText value={entry.label} label={t("nameLabel", { role: role.name })} canEdit={canEdit && !busy} onSave={label => update.mutateAsync({ id: entry.id, patch: { label } })} textClassName={entry.is_active ? undefined : "text-muted-foreground"} />
            <Switch checked={entry.is_active} disabled={busy || (entry.is_active ? !canDeactivate : !canEdit)} aria-label={entry.is_active ? t("deactivate", { name: entry.label }) : t("restore", { name: entry.label })} onCheckedChange={active => active ? update.mutate({ id: entry.id, patch: { is_active: true } }) : deactivate.mutate(entry.id)} />
          </div><p className="font-mono text-xs text-muted-foreground">{entry.slug}</p>
          {(["icon", "color"] as const).map(key => <div key={key} className="space-y-1 text-xs"><span>{roleT(key)} · {roleT(Object.hasOwn(entry.attrs, key) ? entry.attrs[key] === null ? "cleared" : "override" : "inherits")}</span>
            <InlineEditText value={typeof entry.attrs[key] === "string" ? entry.attrs[key] as string : ""} label={`${roleT(key)}: ${entry.label}`} canEdit={canEdit && !busy} onSave={value => update.mutateAsync({ id: entry.id, patch: { [key]: value.trim() || null } })} />
          </div>)}
        </li>)}</ul>}
        {canCreate && <div className="flex gap-2"><Input aria-label={t("nameLabel", { role: role.name })} value={draft} onChange={event => setDraftLabels(prev => ({ ...prev, [role.code]: event.target.value }))} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); add(); } }} placeholder={t("addPlaceholder", { role: role.name })} /><Button type="button" variant="outline" disabled={busy || !draft.trim()} onClick={add}><Plus className="mr-1 size-4" aria-hidden />{t("add")}</Button></div>}
      </CardContent></Card>;
    })}
  </div>;
}
