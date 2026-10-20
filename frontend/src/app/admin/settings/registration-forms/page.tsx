"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  SchemaEditor,
  useSubroleCatalog
} from "@/components/balancer/form/RegistrationFormBuilder";
import {
  blockedFieldKeys,
  sanitizeSchema
} from "@/components/balancer/form/_components/schemaEdits";
import { registrationFormTemplatesKey } from "@/components/balancer/form/_components/TemplateMenu";
import { ConfirmDialog, type ConfirmIntent } from "@/components/kit/ConfirmDialog";
import { InlineEditText } from "@/components/kit/InlineEditText";
import { MasterDetail } from "@/components/kit/MasterDetail";
import { SaveBar } from "@/components/kit/SaveBar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { PageStateCard } from "@/components/ui/page-state-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDisciplineMetadata } from "@/hooks/useDisciplineMetadata";
import { usePermissions } from "@/hooks/usePermissions";
import { useGameScope } from "@/hooks/useGameScope";
import { useQueryParams } from "@/hooks/useQueryParams";
import { GameScopeControl } from "@/components/workspace/GameScopeControl";
import { defaultFormSchema } from "@/lib/forms/default-schema";
import { fieldErrorsFrom } from "@/lib/forms/form-errors";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import registrationFormTemplatesService from "@/services/registration-form-templates.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { FormSchema } from "@/types/forms.types";
import { Spinner } from "@/components/ui/spinner";

/**
 * Saved questionnaires, shared by every tournament of the workspace (T4).
 *
 * The same editor the tournament builder runs, without the tournament: there is
 * no form row to version, no stale-registration count and no policy toggles to
 * echo back — a template is a schema and a name, and applying one to a
 * tournament is the builder's "Load template".
 *
 * `?template=` is the selection, written with `mode: "push"`: below `md`
 * `MasterDetail` shows the list or the editor, and its Back is `history.back()`.
 */
export default function WorkspaceRegistrationFormsSettingsPage() {
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const scope = useGameScope({ pageClass: "single", axis: workspaceId ?? "all" });
  const discipline = scope.game;
  const { canAccessPermission } = usePermissions();
  const queryClient = useQueryClient();
  const tErrors = useTranslations("forms.errors");
  const t = useTranslations("adminSettings.registrationForms");
  const tTable = useTranslations("kitTable.dataTableExtra");
  const { searchParams, setParams } = useQueryParams({ mode: "push" });

  const selectedId = Number(searchParams?.get("template")) || null;
  const setSelectedId = (id: number | null) => setParams({ template: id });
  const [edit, setEdit] = useState<{ templateId: number; schema: FormSchema } | null>(null);
  /**
   * The selected template's unsaved schema, `null` = its saved one. Edits
   * belong to the template they were made on, so a selection that changes
   * without `openTemplate` (browser Back, the narrow-viewport Back) leaves
   * them behind instead of pasting them onto another template.
   */
  const draft = edit !== null && edit.templateId === selectedId ? edit.schema : null;
  const setDraft = (schema: FormSchema | null) =>
    setEdit(schema !== null && selectedId !== null ? { templateId: selectedId, schema } : null);
  const [newName, setNewName] = useState("");
  /**
   * The destructive action waiting on a confirmation: deleting a shared
   * template, or walking away from unsaved questions. Both are one dialog with
   * a swapped intent, the pattern every other section of this hub follows —
   * and neither is recoverable from the UI once done.
   */
  const [pending, setPending] = useState<
    { kind: "delete"; id: number; name: string } | { kind: "switch"; id: number } | null
  >(null);

  const canEdit = canAccessPermission("registration_form.update", workspaceId);
  const { catalog, loading: catalogLoading } = useSubroleCatalog(workspaceId, discipline);
  const metadata = useDisciplineMetadata(workspaceId ?? "all", workspaceId !== null ? discipline : null);

  const listQuery = useQuery({
    queryKey: registrationFormTemplatesKey(workspaceId ?? 0),
    queryFn: () => registrationFormTemplatesService.list(workspaceId as number),
    enabled: workspaceId !== null
  });

  const templates = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  const selected = templates.find((template) => template.id === selectedId) ?? null;
  const schema = draft ?? selected?.form_schema ?? null;
  const blocked = schema ? blockedFieldKeys(schema) : null;

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: registrationFormTemplatesKey(workspaceId ?? 0) });

  // The browsed game's own identity provider: a template starts from the questionnaire the server would
  // build for a fresh tournament OF THAT GAME. A game that declares none has no handle to ask for.
  const identityProvider =
    scope.games?.find((entry) => entry.code === discipline)?.identity_provider ?? null;

  const createMutation = useMutation({
    mutationFn: (name: string) => {
      if (identityProvider === null) throw new Error("no identity provider");
      // "New template" and "new tournament" never disagree about what a form asks by default.
      return registrationFormTemplatesService.create(
        workspaceId as number,
        name,
        // An identity provider is only resolved for a resolved game.
        discipline as string,
        defaultFormSchema(identityProvider)
      );
    },
    onSuccess: async (created) => {
      setNewName("");
      await invalidate();
      // Opening the new template would discard whatever is unsaved in the pane
      // — the same loss the switch confirmation exists to prevent, so the
      // selection simply stays put and the row is waiting in the list.
      if (draft !== null) {
        notify.success(t("toast.createdOpenLater", { name: created.name }));
        return;
      }
      setSelectedId(created.id);
      notify.success(t("toast.created"));
    },
    onError: (error) => notify.error(fieldErrorsFrom(error, tErrors).form ?? t("errors.create"))
  });

  const saveMutation = useMutation({
    mutationFn: ({ id, name, form_schema }: { id: number; name: string; form_schema: FormSchema }) =>
      registrationFormTemplatesService.update(workspaceId as number, id, name, form_schema),
    onSuccess: async () => {
      setDraft(null);
      await invalidate();
      notify.success(t("toast.saved"));
    },
    onError: (error) => notify.error(fieldErrorsFrom(error, tErrors).form ?? t("errors.save"))
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => registrationFormTemplatesService.remove(workspaceId as number, id),
    onSuccess: async (_result, id) => {
      if (selectedId === id) {
        setSelectedId(null);
        setDraft(null);
      }
      await invalidate();
      notify.success(t("toast.deleted"));
    },
    onError: (error) => notify.apiError(error, { title: t("errors.delete") })
  });

  /** Select a template, asking first when the one on screen has unsaved edits. */
  const openTemplate = (id: number) => {
    if (id === selectedId) return;
    if (draft !== null) {
      setPending({ kind: "switch", id });
      return;
    }
    setSelectedId(id);
  };

  const confirmIntent: ConfirmIntent =
    pending?.kind === "delete"
      ? {
          title: t("confirm.deleteTitle"),
          description: t("confirm.deleteDescription", { name: pending.name }),
          confirmLabel: t("confirm.delete"),
          tone: "danger"
        }
      : {
          title: t("confirm.discardTitle"),
          description: t("confirm.discardDescription"),
          confirmLabel: t("confirm.discard"),
          tone: "warning"
        };

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

  if (listQuery.isError) {
    return (
      <PageStateCard
        state="error"
        title={t("errors.load")}
        onAction={() => void listQuery.refetch()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Unsaved questions belong to this game's template: the game tabs wait until they are saved or dropped. */}
      {draft === null ? <GameScopeControl scope={scope} variant="single" /> : null}
      <MasterDetail
        list={
          <div className="flex flex-col gap-2">
            {listQuery.isLoading ? (
              <Skeleton className="h-40 w-full rounded-md" />
            ) : templates.length > 0 ? (
              <nav aria-label={t("listLabel")} className="rounded-xl border border-border bg-card p-2">
                <ul className="flex flex-col gap-0.5">
                  {templates.map((template) => {
                    const isSelected = template.id === selectedId;
                    return (
                      <li key={template.id}>
                        <button
                          type="button"
                          aria-current={isSelected ? "true" : undefined}
                          onClick={() => openTemplate(template.id)}
                          className={cn(
                            "w-full truncate rounded-md px-2 py-1.5 text-left text-sm",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            isSelected
                              ? "bg-accent/40 font-medium text-foreground"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {template.name}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            ) : null}

            {canEdit && (
              <div className="flex items-center gap-2">
                <Input
                  value={newName}
                  aria-label={t("newTemplateName")}
                  placeholder={t("newTemplateName")}
                  onChange={(event) => setNewName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && newName.trim() && identityProvider !== null) {
                      event.preventDefault();
                      createMutation.mutate(newName.trim());
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  disabled={!newName.trim() || identityProvider === null || createMutation.isPending}
                  onClick={() => createMutation.mutate(newName.trim())}
                >
                  {createMutation.isPending ? (
                    <Spinner className="mr-1 size-3.5" />
                  ) : (
                    <Plus className="mr-1 size-3.5" aria-hidden />
                  )}
                  {t("add")}
                </Button>
              </div>
            )}
          </div>
        }
        detail={
          selected && schema ? (
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1 text-base font-semibold">
                  <InlineEditText
                    value={selected.name}
                    label={t("templateName")}
                    canEdit={canEdit}
                    onSave={(name) =>
                      saveMutation.mutateAsync({
                        id: selected.id,
                        name,
                        // Renaming must not publish the schema being edited
                        // below it: a rename sends what is SAVED.
                        form_schema: selected.form_schema
                      })
                    }
                  />
                </div>
                {canEdit && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={tTable("actionsFor", { label: selected.name })}
                        title={tTable("actionsFor", { label: selected.name })}
                      >
                        <MoreHorizontal aria-hidden className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        className="text-danger focus:text-danger"
                        onSelect={() =>
                          setPending({ kind: "delete", id: selected.id, name: selected.name })
                        }
                      >
                        {t("delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              <SchemaEditor
                key={selected.id}
                schema={schema}
                onChange={setDraft}
                subroleCatalog={catalog}
                catalogLoading={catalogLoading}
                metadata={metadata.data ?? null}
                fieldErrors={{}}
              />
            </section>
          ) : null
        }
        emptyDetail={
          listQuery.isLoading ? null : (
            <PageStateCard
              state="empty"
              title={templates.length === 0 ? t("emptyTitle") : t("pickTitle")}
              description={
                templates.length === 0
                  ? t("emptyDescription")
                  : t("pickDescription")
              }
            />
          )
        }
      />

      {selected && schema && (
        <SaveBar
          dirty={draft !== null}
          summary={blocked && blocked.size > 0 ? t("fixQuestions") : t("unsavedChanges")}
          saving={saveMutation.isPending}
          primaryLabel={t("save")}
          onDiscard={() => setDraft(null)}
          onSave={() => {
            if (blocked && blocked.size > 0) {
              notify.error(t("fixQuestions"));
              return;
            }
            saveMutation.mutate({
              id: selected.id,
              name: selected.name,
              form_schema: sanitizeSchema(schema)
            });
          }}
        />
      )}

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        intent={confirmIntent}
        pending={deleteMutation.isPending}
        onConfirm={async () => {
          if (pending === null) return;
          if (pending.kind === "delete") {
            await deleteMutation.mutateAsync(pending.id);
          } else {
            setDraft(null);
            setSelectedId(pending.id);
          }
          setPending(null);
        }}
      />
    </div>
  );
}
