"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { useAuthProfile } from "@/hooks/useAuthProfile";
import { notify } from "@/lib/notify";
import { translateRegistrationTeamError } from "@/lib/registration-team-errors";
import { ROLES, type RoleCode } from "@/lib/roles";
import { isRoleSlotCode } from "@/lib/roster-shape";
import { tournamentQueryKeys } from "@/lib/tournament-query-keys";
import meService from "@/services/me.service";
import registrationTeamService from "@/services/registration-team.service";
import type { RegistrationCreateInput, RegistrationForm } from "@/types/registration.types";

import UnifiedRegistrationForm from "./UnifiedRegistrationForm";

interface InviteAcceptWizardProps {
  workspaceId: number;
  tournamentId: number;
  tournamentName?: string;
  form: RegistrationForm;
  teamName: string;
  /** The slot the invite bought. `flex` is possible on a role-less roster. */
  slotCode: string;
  isSubstitute: boolean;
  /** Exactly one of these — the same rule the backend enforces. */
  token?: string;
  inviteId?: number;
  onClose: () => void;
}

/**
 * Invitee flow: register, and take the slot the invite offered.
 *
 * The slot is NOT a choice here. It is fixed by the invite, so the role step is
 * locked to one row (`lockedRole`) and the payload can only ever name that role.
 * Letting the invitee pick would let them register for a slot the captain did not
 * offer — the server would reject it as `slot_taken`/`slot_not_in_shape`, but only
 * after they filled the whole form.
 */
export default function InviteAcceptWizard({
  workspaceId,
  tournamentId,
  tournamentName,
  form,
  teamName,
  slotCode,
  isSubstitute,
  token,
  inviteId,
  onClose,
}: Readonly<InviteAcceptWizardProps>) {
  const t = useTranslations("registrationTeams");
  const tErrors = useTranslations("registrationTeams.errors");
  const { user: authUser } = useAuthProfile();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const userQuery = useQuery({
    queryKey: ["me", "social"],
    queryFn: () => meService.getSocialAccounts(),
    enabled: !!authUser,
    staleTime: 60_000,
  });

  const reference = token ? { token } : { invite_id: inviteId };

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: tournamentQueryKeys.registrationTeams(workspaceId, tournamentId),
      }),
      queryClient.invalidateQueries({
        queryKey: tournamentQueryKeys.registration(workspaceId, tournamentId),
      }),
      queryClient.invalidateQueries({
        queryKey: tournamentQueryKeys.registrationsList(workspaceId, tournamentId),
      }),
    ]);

  const acceptMutation = useMutation({
    mutationFn: (registration: RegistrationCreateInput) =>
      registrationTeamService.accept({ ...reference, registration }),
    onSuccess: async () => {
      notify.success(t("accept.success", { team: teamName }));
      await invalidate();
      onClose();
    },
    onError: (err: unknown) => setError(translateRegistrationTeamError(tErrors, err)),
  });

  const declineMutation = useMutation({
    mutationFn: () => registrationTeamService.decline(reference),
    onSuccess: async () => {
      notify.success(t("accept.declineSuccess"));
      await invalidate();
      onClose();
    },
    onError: (err: unknown) => notify.error(translateRegistrationTeamError(tErrors, err)),
  });

  // `flex` has no matrix row, and a role-less roster asks no role question at all,
  // so the ordinary matrix is the honest UI there. Only a real role slot locks.
  const lockedRole: RoleCode | null = isRoleSlotCode(slotCode) ? slotCode : null;
  const slotLabel = ROLES.find((role) => role.code === lockedRole)?.display ?? slotCode;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-1.5 rounded-lg border border-[color:var(--aqt-border)] bg-muted/20 p-3">
        <p className="text-sm font-medium">{t("accept.title", { team: teamName })}</p>
        <p className="text-xs text-[color:var(--aqt-fg-muted)]">
          {t("accept.slotLocked", { slot: slotLabel })}
        </p>
        {isSubstitute && (
          <p className="text-xs text-warning">{t("accept.substituteNotice")}</p>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <UnifiedRegistrationForm
        mode="public"
        tournamentId={tournamentId}
        workspaceId={workspaceId}
        formConfig={form}
        tournamentName={tournamentName}
        userProfile={userQuery.data}
        lockedRole={lockedRole}
        onSubmit={async (payload) => {
          setError(null);
          await acceptMutation.mutateAsync(payload);
        }}
        onCancel={onClose}
        submitPending={acceptMutation.isPending}
      />

      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          disabled={declineMutation.isPending || acceptMutation.isPending}
          onClick={() => {
            if (!window.confirm(t("accept.declineConfirm"))) return;
            declineMutation.mutate();
          }}
        >
          {t("accept.decline")}
        </Button>
      </div>
    </div>
  );
}
