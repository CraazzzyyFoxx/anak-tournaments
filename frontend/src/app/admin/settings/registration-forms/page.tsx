"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
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
import { SaveBar } from "@/components/kit/SaveBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageStateCard } from "@/components/ui/page-state-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDisciplineMetadata } from "@/hooks/useDisciplineMetadata";
import { usePermissions } from "@/hooks/usePermissions";
import { useBrowsingDiscipline } from "@/hooks/useBrowsingDiscipline";
import { DisciplineSelector, DisciplineUnavailable } from "@/components/workspace/DisciplineSelector";
import { defaultFormSchema } from "@/lib/forms/default-schema";
import { fieldErrorsFrom } from "@/lib/forms/form-errors";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import registrationFormTemplatesService from "@/services/registration-form-templates.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { FormSchema } from "@/types/forms.types";
import { Spinner } from "@/components/ui/spinner";

/**
 * Saved questionnaires, shared by every tournament of the workspace.
 *
 * The same editor the tournament builder runs, without the tournament: there is
 * no form row to version, no stale-registration count and no policy toggles to
 * echo back — a template is a schema and a name, and applying one to a
 * tournament is the builder's "Load template".
 *
 * Copy here is plain English like its neighbours in this hub (`sub-roles`,
 * `statuses`, `divisions`); the editor inside carries its own i18n.
 */
export default function WorkspaceRegistrationFormsSettingsPage() {
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const browsing = useBrowsingDiscipline({ allowsAll: false, axis: workspaceId ?? "all" });
  const discipline = browsing.resolved?.kind === "concrete" ? browsing.resolved.code : null;
  const { canAccessPermission } = usePermissions();
  const queryClient = useQueryClient();
  const tErrors = useTranslations("forms.errors");
  const t = useTranslations("adminSettings.registrationForms");

  const [selectedId, setSelectedId] = useState<number | null>(null);
  /** `null` = the selected template's saved schema, untouched. */
  const [draft, setDraft] = useState<FormSchema | null>(null);
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
    browsing.disciplines?.find((entry) => entry.code === discipline)?.identity_provider ?? null;

  const createMutation = useMutation({
    mutationFn: (name: string) => {
      if (identityProvider === null) throw new Error("no identity provider");
      // "New template" and "new tournament" never disagree about what a form asks by default.
      return registrationFormTemplatesService.create(
        workspaceId as number,
        name,
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
  if (browsing.resolved?.kind === "invalid" || browsing.resolved?.kind === "empty") {
    return <DisciplineUnavailable resolved={browsing.resolved} disciplines={browsing.disciplines ?? []} allowsAll={false} onSelect={browsing.select} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <DisciplineSelector disciplines={browsing.disciplines ?? []} value={discipline ?? undefined} allowsAll={false} onSelect={browsing.select} disabled={draft !== null} />
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex w-full shrink-0 flex-col gap-2 lg:w-72">
          {listQuery.isLoading ? (
            <Skeleton className="h-40 w-full rounded-md" />
          ) : (
            <ul className="flex flex-col gap-1.5">
              {templates.map((template) => (
                <li
                  key={template.id}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-2.5 py-1.5",
                    template.id === selectedId
                      ? "border-primary/40 bg-primary/10"
                      : "border-border/60"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <InlineEditText
                      value={template.name}
                      label={t("templateName")}
                      canEdit={canEdit}
                      onSave={(name) =>
                        saveMutation.mutateAsync({
                          id: template.id,
                          name,
                          // Renaming must not publish the schema being edited in
                          // the pane next to it: a rename sends what is SAVED.
                          form_schema: template.form_schema
                        })
                      }
                    />
                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                      onClick={() => openTemplate(template.id)}
                    >
                      {template.id === selectedId ? t("editing") : t("editQuestions")}
                    </button>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0"
                    disabled={!canEdit || deleteMutation.isPending}
                    aria-label={t("deleteNamed", { name: template.name })}
                    onClick={() =>
                      setPending({ kind: "delete", id: template.id, name: template.name })
                    }
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {canEdit && (
            <div className="flex items-center gap-2">
              <Input
                value={newName}
                placeholder={t("newTemplateName")}
                className="h-8 text-xs"
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
                size="sm"
                className="h-8 shrink-0"
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

        <div className="min-w-0 flex-1">
          {selected && schema ? (
            <SchemaEditor
              key={selected.id}
              schema={schema}
              onChange={setDraft}
              subroleCatalog={catalog}
              catalogLoading={catalogLoading}
              metadata={metadata.data ?? null}
              fieldErrors={{}}
            />
          ) : (
            <PageStateCard
              state="empty"
              title={templates.length === 0 ? t("emptyTitle") : t("pickTitle")}
              description={
                templates.length === 0
                  ? t("emptyDescription")
                  : t("pickDescription")
              }
            />
          )}
        </div>
      </div>

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
