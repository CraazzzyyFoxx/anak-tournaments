"use client";

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { notify } from "@/lib/notify";
import { toRegistrationFormUpsert } from "@/lib/registration/form-upsert";
import balancerAdminService from "@/services/balancer-admin.service";
import type {
  AdminRegistrationForm,
  AdminRegistrationFormUpsert
} from "@/types/balancer-admin.types";
import { balancerQueryKeys } from "@/lib/balancer/query-keys";
import { useTranslations } from "next-intl";
import { useHubTournamentQuery } from "../hubQueries";

/** Same key the questionnaire builder uses, so the four editors share one read. */
export const registrationFormQueryKey = (tournamentId: number) =>
  balancerQueryKeys.registrationForm(tournamentId);

export interface RegistrationFormSection {
  /** The saved form plus edits; null until a saved schema or its owner resolves. */
  value: AdminRegistrationFormUpsert | null;
  /** Read-only projections the server resolves; absent until the first save. */
  saved: AdminRegistrationForm | null;
  patch: (next: Partial<AdminRegistrationFormUpsert>) => void;
  dirty: boolean;
  summary: string;
  loading: boolean;
  error: Error | null;
  retry: () => void;
  saving: boolean;
  save: () => void;
  discard: () => void;
}

/**
 * Form state of one registration-form settings section.
 *
 * The counterpart of `useTournamentSettingsForm`, with one structural
 * difference that is the whole reason it exists: the tournament PATCH takes a
 * scoped diff, while `PUT registration-form` is a full replace. A section that
 * sent only its own fields would reset every field belonging to the other three
 * screens, so the save is always `saved form + this section's edits`.
 *
 * Edits are held as a patch rather than as per-field state so `dirty` is
 * literally "fields this screen changed" — no baseline comparison, and a
 * background refetch cannot silently un-dirty an edit.
 */
export function useRegistrationFormSection(tournamentId: number): RegistrationFormSection {
  const queryClient = useQueryClient();
  const t = useTranslations("adminTournament.registrationForm");
  const [patchState, setPatchState] = useState<Partial<AdminRegistrationFormUpsert>>({});
  const tournamentQuery = useHubTournamentQuery(tournamentId);
  const identityProvider = tournamentQuery.data?.identity_provider;

  const query = useQuery({
    queryKey: registrationFormQueryKey(tournamentId),
    queryFn: () => balancerAdminService.getRegistrationForm(tournamentId),
    // A settings screen is a long-lived editor; a background refetch must not
    // clobber unsaved edits.
    refetchOnWindowFocus: false
  });

  // An absent row is normal, but only its resolved owner can supply a default.
  const saved = query.data ?? null;

  const value = useMemo(
    () =>
      saved?.form_schema || (query.isSuccess && identityProvider)
        ? { ...toRegistrationFormUpsert(saved, identityProvider), ...patchState }
        : null,
    [saved, query.isSuccess, identityProvider, patchState]
  );

  const patch = useCallback((next: Partial<AdminRegistrationFormUpsert>) => {
    setPatchState((current) => ({ ...current, ...next }));
  }, []);

  const mutation = useMutation({
    mutationFn: (payload: AdminRegistrationFormUpsert) =>
      balancerAdminService.upsertRegistrationForm(tournamentId, payload),
    onSuccess: async (updated) => {
      queryClient.setQueryData(registrationFormQueryKey(tournamentId), updated);
      setPatchState({});
      notify.success(t("saved"));
    },
    onError: () => notify.error(t("saveError"))
  });

  const changed = Object.keys(patchState).length;
  const error = query.error ?? (value === null ? tournamentQuery.error : null);

  return {
    value,
    saved,
    patch,
    dirty: changed > 0,
    summary: t("changed", { count: changed }),
    loading: value === null && !error,
    error,
    retry: () => {
      if (query.isError) void query.refetch();
      else void tournamentQuery.refetch();
    },
    saving: mutation.isPending,
    save: () => {
      if (value) mutation.mutate(value);
    },
    discard: () => setPatchState({})
  };
}
