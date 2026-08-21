"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthProfile } from "@/hooks/useAuthProfile";
import { notify } from "@/lib/notify";
import { translateRegistrationTeamError } from "@/lib/registration-team-errors";
import { ROLES, type RoleCode } from "@/lib/roles";
import { tournamentQueryKeys } from "@/lib/tournament-query-keys";
import { cn } from "@/lib/utils";
import meService from "@/services/me.service";
import registrationTeamService from "@/services/registration-team.service";
import type { RegistrationCreateInput, RegistrationForm } from "@/types/registration.types";

import UnifiedRegistrationForm from "./UnifiedRegistrationForm";

interface TeamRegistrationWizardProps {
  workspaceId: number;
  tournamentId: number;
  tournamentName?: string;
  form: RegistrationForm;
  /** Slots this tournament's roster actually has, in canonical order. A captain
   *  cannot occupy a slot the shape does not define, and the backend rejects it
   *  with `slot_not_in_shape` — offering it would be a dead end. */
  availableSlots: RoleCode[];
  onClose: () => void;
}

/**
 * Captain flow: create a team and register yourself onto it in one call.
 *
 * The team name and the captain's own slot live ABOVE the ordinary registration
 * wizard rather than inside it: they are team facts, not registration fields, and
 * the wizard's step machinery is driven by `formConfig.built_in_fields`, which
 * knows nothing about teams.
 *
 * The captain is a member like anyone else (decision 5) — they occupy a real slot
 * and their registration goes through exactly the same validation as a solo
 * entrant, which is why this delegates rather than reimplementing.
 */
export default function TeamRegistrationWizard({
  workspaceId,
  tournamentId,
  tournamentName,
  form,
  availableSlots,
  onClose,
}: Readonly<TeamRegistrationWizardProps>) {
  const t = useTranslations("registrationTeams");
  const tErrors = useTranslations("registrationTeams.errors");
  const { user: authUser } = useAuthProfile();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [slot, setSlot] = useState<RoleCode | null>(availableSlots[0] ?? null);
  const [error, setError] = useState<string | null>(null);

  const userQuery = useQuery({
    queryKey: ["me", "social"],
    queryFn: () => meService.getSocialAccounts(),
    enabled: !!authUser,
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: (registration: RegistrationCreateInput) => {
      if (!slot) throw new Error("no slot");
      return registrationTeamService.create(tournamentId, {
        name: name.trim(),
        slot_code: slot,
        registration,
      });
    },
    onSuccess: async () => {
      notify.success(t("create.success"));
      await Promise.all([
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
      onClose();
    },
    onError: (err: unknown) => setError(translateRegistrationTeamError(tErrors, err)),
  });

  const slotLabel = (code: RoleCode) =>
    ROLES.find((role) => role.code === code)?.display ?? code;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <div className="grid gap-3 rounded-lg border border-[color:var(--aqt-border)] bg-muted/20 p-3">
        <div className="grid gap-1.5">
          <Label htmlFor="regteam-name">{t("create.nameLabel")}</Label>
          <Input
            id="regteam-name"
            value={name}
            maxLength={255}
            placeholder={t("create.namePlaceholder")}
            onChange={(event) => setName(event.target.value)}
          />
          <p className="text-xs text-[color:var(--aqt-fg-muted)]">{t("create.nameHint")}</p>
        </div>

        <div className="grid gap-1.5">
          <span className="text-sm font-medium">{t("create.slotLabel")}</span>
          <div className="flex flex-wrap gap-2">
            {availableSlots.map((code) => (
              <button
                key={code}
                type="button"
                aria-pressed={slot === code}
                onClick={() => setSlot(code)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                  slot === code
                    ? "border-[color:var(--aqt-accent)] bg-[color:color-mix(in_srgb,var(--aqt-accent)_12%,transparent)]"
                    : "border-[color:var(--aqt-border)] hover:bg-muted/40",
                )}
              >
                {slotLabel(code)}
              </button>
            ))}
          </div>
          <p className="text-xs text-[color:var(--aqt-fg-muted)]">{t("create.slotHint")}</p>
        </div>
      </div>

      <UnifiedRegistrationForm
        mode="public"
        tournamentId={tournamentId}
        workspaceId={workspaceId}
        formConfig={form}
        tournamentName={tournamentName}
        userProfile={userQuery.data}
        // The captain's chosen slot drives the role step, so the matrix shows the
        // one row they will actually play instead of asking the question twice.
        lockedRole={slot}
        onSubmit={async (payload) => {
          setError(null);
          // The name is validated server-side too (`team_name_required` /
          // `team_name_invalid` / `team_name_taken`), but failing here avoids
          // walking the whole wizard before finding out.
          if (!name.trim()) {
            setError(tErrors("team_name_required"));
            return;
          }
          if (name.includes("#")) {
            setError(tErrors("team_name_invalid"));
            return;
          }
          await mutation.mutateAsync(payload);
        }}
        onCancel={onClose}
        submitPending={mutation.isPending}
      />
    </div>
  );
}
