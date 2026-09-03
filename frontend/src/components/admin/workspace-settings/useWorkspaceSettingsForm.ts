"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { notify } from "@/lib/notify";
import workspaceService from "@/services/workspace.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { Workspace } from "@/types/workspace.types";
import {
  buildPayload,
  diffPayload,
  formFromWorkspace,
  sectionPayload,
  type WorkspaceSettingsFormState
} from "./fields";
import type { WorkspaceRecordSectionKey } from "./sections";

/** Everything a settings section needs to render and save its own fields. */
export interface WorkspaceSettingsForm {
  workspace: Workspace | undefined;
  isLoading: boolean;
  isError: boolean;
  form: WorkspaceSettingsFormState | null;
  /** Merges a partial into the form; the only way a section mutates it. */
  patch: (values: Partial<WorkspaceSettingsFormState>) => void;
  dirty: boolean;
  /** "2 changed fields" for the `SaveBar` summary. */
  summary: string;
  saving: boolean;
  /** The PATCH body this section would send right now — the diff, scoped. */
  payload: Partial<WorkspaceSettingsFormState>;
  save: () => void;
  discard: () => void;
  /** Re-read `admin-workspaces`, `admin-workspace` and the picker store. */
  invalidate: () => void;
}

/**
 * Form state of one workspace settings section, and the scoped diff it saves.
 *
 * Every section shares this hook, so "what changed" is computed once from
 * `FIELD_DEFS` and each page only decides which controls to render.
 */
export function useWorkspaceSettingsForm(
  workspaceId: number | null,
  section: WorkspaceRecordSectionKey
): WorkspaceSettingsForm {
  const queryClient = useQueryClient();
  const fetchWorkspaces = useWorkspaceStore((state) => state.fetchWorkspaces);

  // The `["admin-workspace", id]` key is a cross-module contract, not a local
  // convention: `components/admin/breadcrumb-registry.ts` reads this exact
  // cache entry to name the workspace crumb.
  const query = useQuery({
    queryKey: ["admin-workspace", workspaceId ?? 0],
    queryFn: () => workspaceService.getById(workspaceId as number),
    enabled: workspaceId !== null && Number.isFinite(workspaceId)
  });
  const workspace = query.data;

  const [state, setState] = useState<{
    form: WorkspaceSettingsFormState;
    baseline: WorkspaceSettingsFormState;
  } | null>(null);

  useEffect(() => {
    if (!workspace) return;
    const next = formFromWorkspace(workspace);
    // A refetch — ours after a save, or another admin's write arriving through
    // an invalidation — always re-baselines, but only replaces the form while
    // the user has nothing unsaved to lose.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState((current) => {
      if (!current) return { form: next, baseline: next };
      const changed = diffPayload(
        buildPayload(current.form),
        buildPayload(current.baseline)
      );
      return {
        form: Object.keys(changed).length > 0 ? current.form : next,
        baseline: next
      };
    });
  }, [workspace]);

  const payload = useMemo(
    () => (state ? sectionPayload(section, state.form, state.baseline) : {}),
    [state, section]
  );

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["admin-workspaces"] });
    if (workspaceId !== null) {
      queryClient.invalidateQueries({ queryKey: ["admin-workspace", workspaceId] });
    }
    void fetchWorkspaces();
  }, [queryClient, workspaceId, fetchWorkspaces]);

  const mutation = useMutation({
    mutationFn: () => workspaceService.update(workspaceId as number, payload),
    onSuccess: () => {
      invalidate();
      notify.success("Settings saved");
    },
    onError: (error) => notify.apiError(error, { title: "Could not save these settings" })
  });

  const patch = useCallback(
    (values: Partial<WorkspaceSettingsFormState>) =>
      setState((current) =>
        current ? { ...current, form: { ...current.form, ...values } } : current
      ),
    []
  );
  const discard = useCallback(
    () => setState((current) => (current ? { ...current, form: current.baseline } : current)),
    []
  );

  const changedCount = Object.keys(payload).length;

  return {
    workspace,
    isLoading: query.isLoading,
    isError: query.isError,
    form: state?.form ?? null,
    patch,
    dirty: changedCount > 0,
    summary: changedCount === 1 ? "1 changed field" : `${changedCount} changed fields`,
    saving: mutation.isPending,
    payload,
    save: () => mutation.mutate(),
    discard,
    invalidate
  };
}
