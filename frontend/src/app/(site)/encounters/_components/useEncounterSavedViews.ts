"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import encounterService from "@/services/encounter.service";
import { encounterQueryKeys } from "@/lib/encounters/query-keys";
import { notify } from "@/lib/notify";
import { getCurrentPathForAuthRedirect } from "@/lib/auth/redirect";
import { useAuthProfile } from "@/hooks/useAuthProfile";
import { useAuthModalStore } from "@/stores/auth-modal.store";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { EncounterSavedView } from "@/types/encounter.types";

import type { EncounterFilterState } from "./encounters.helpers";

export interface SavedViewCallbacks {
  /** Run after a successful save — closes the naming dialog. */
  onSaved: () => void;
  /** Run after a successful delete — dismisses the confirmation. */
  onDeleted: () => void;
}

export interface EncounterSavedViews {
  /** `undefined` for an anonymous viewer, and while the list loads. */
  views: EncounterSavedView[] | undefined;
  savePending: boolean;
  /** The last save's refusal, shown in the naming dialog (`null` once cleared). */
  saveError: unknown;
  clearSaveError: () => void;
  deletePending: boolean;
  /**
   * Opens the sign-in modal (returning here afterwards) and answers `false`
   * when the viewer has no account to save a view onto.
   */
  requireAuth: () => boolean;
  save: (name: string, filters: EncounterFilterState) => void;
  remove: (id: number) => void;
}

/** The viewer's own saved filter sets, plus the writes that maintain them. */
export function useEncounterSavedViews({ onSaved, onDeleted }: SavedViewCallbacks): EncounterSavedViews {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const { user } = useAuthProfile();
  const openAuthModal = useAuthModalStore((state) => state.open);
  const currentWorkspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const listKey = encounterQueryKeys.savedViews(currentWorkspaceId, user?.username);

  const savedViewsQuery = useQuery({
    queryKey: listKey,
    queryFn: () => encounterService.getSavedViews(currentWorkspaceId),
    enabled: Boolean(user && currentWorkspaceId != null),
    placeholderData: (previous) => previous,
    retry: false,
    staleTime: 60_000
  });

  const saveViewMutation = useMutation({
    // A refusal (a taken name, the 20-view limit) belongs in the dialog, next to the name it is about.
    meta: { suppressErrorToast: true },
    mutationFn: ({ name, filters }: { name: string; filters: EncounterFilterState }) =>
      encounterService.saveView(name, filters, currentWorkspaceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listKey });
      onSaved();
      notify.success(t("encounters.savedViews.saved"));
    }
  });

  const deleteViewMutation = useMutation({
    mutationFn: ({ id }: { id: number }) => encounterService.deleteView(id, currentWorkspaceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listKey });
      onDeleted();
      notify.success(t("encounters.savedViews.deleted"));
    }
  });

  return {
    views: user ? savedViewsQuery.data : undefined,
    savePending: saveViewMutation.isPending,
    saveError: saveViewMutation.error,
    clearSaveError: saveViewMutation.reset,
    deletePending: deleteViewMutation.isPending,
    requireAuth: () => {
      if (user) return true;
      openAuthModal(getCurrentPathForAuthRedirect(window.location));
      return false;
    },
    save: (name, filters) => saveViewMutation.mutate({ name, filters }),
    remove: (id) => deleteViewMutation.mutate({ id })
  };
}
