"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Crown, LogOut, Trash2, UserMinus, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { EditableAvatar } from "@/components/ui/editable-avatar";
import { notify } from "@/lib/notify";
import { MAX_AVATAR_BYTES } from "@/lib/avatar";
import { formatShortfall } from "@/lib/registration-team-shortfall";
import { translateRegistrationTeamError } from "@/lib/registration-team-errors";
import { ROSTER_SLOT_CODES, type RosterSlotCode } from "@/lib/roster-shape";
import { tournamentQueryKeys } from "@/lib/tournament-query-keys";
import { cn } from "@/lib/utils";
import registrationTeamService from "@/services/registration-team.service";
import type { RegistrationTeam } from "@/types/registration-team.types";

interface MyTeamPanelProps {
  workspaceId: number;
  tournamentId: number;
  team: RegistrationTeam;
  /** True when the viewer is this team's captain — the only actor allowed to
   *  invite, kick, transfer or disband. Mirrors the server's `not_captain` gate;
   *  hiding the controls is UX, the gate is the backend's. */
  isCaptain: boolean;
}

/**
 * The roster-management surface for a team the viewer belongs to.
 *
 * Captain-only actions are hidden for ordinary members, who keep exactly one:
 * leaving. A captain cannot leave — they must transfer or disband, because a
 * captain silently vanishing from a team other people already joined leaves a
 * roster nobody can edit (the server enforces this as `captain_must_transfer`).
 */
export default function MyTeamPanel({
  workspaceId,
  tournamentId,
  team,
  isCaptain,
}: Readonly<MyTeamPanelProps>) {
  const t = useTranslations("registrationTeams");
  const tErrors = useTranslations("registrationTeams.errors");
  // The same translated slot vocabulary the admin card and the public tab use, so
  // one roster never shows "DPS" in its shortfall and "Урон" on a chip.
  const tSlot = useTranslations("rosterShape.slotCodes");
  const queryClient = useQueryClient();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteSlot, setInviteSlot] = useState<RosterSlotCode | null>(null);
  const [inviteSubstitute, setInviteSubstitute] = useState(false);
  /** Shown once, never refetchable: only the hash is stored server-side. */
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: tournamentQueryKeys.registrationTeams(workspaceId, tournamentId),
    });

  /** Every mutation here reports failure through the code→i18n map: the server's
   *  `msg` is English and this is a public, Russian-first surface. */
  const failure = (err: unknown) => notify.error(translateRegistrationTeamError(tErrors, err));

  const inviteMutation = useMutation({
    mutationFn: () => {
      if (!inviteSlot) throw new Error("no slot");
      return registrationTeamService.invite(team.id, {
        slot_code: inviteSlot,
        is_substitute: inviteSubstitute,
      });
    },
    onSuccess: async (invite) => {
      notify.success(t("invite.success"));
      // A link invite hands back the raw token exactly once. Keep it on screen
      // instead of closing, or the captain loses it with no way to recover it.
      setIssuedToken(invite.token ?? null);
      if (!invite.token) setInviteOpen(false);
      await invalidate();
    },
    onError: failure,
  });

  const revokeMutation = useMutation({
    mutationFn: (inviteId: number) => registrationTeamService.revokeInvite(inviteId),
    onSuccess: async () => {
      notify.success(t("invite.revokeSuccess"));
      await invalidate();
    },
    onError: failure,
  });

  const kickMutation = useMutation({
    mutationFn: (registrationId: number) => registrationTeamService.kick(team.id, registrationId),
    onSuccess: async () => {
      notify.success(t("member.kickSuccess"));
      await invalidate();
    },
    onError: failure,
  });

  const transferMutation = useMutation({
    mutationFn: (registrationId: number) =>
      registrationTeamService.transferCaptaincy(team.id, registrationId),
    onSuccess: async () => {
      notify.success(t("member.makeCaptainSuccess"));
      await invalidate();
    },
    onError: failure,
  });

  const leaveMutation = useMutation({
    mutationFn: () => registrationTeamService.leave(team.id),
    onSuccess: async () => {
      notify.success(t("member.leaveSuccess"));
      await invalidate();
    },
    onError: failure,
  });

  const disbandMutation = useMutation({
    mutationFn: () => registrationTeamService.disband(team.id),
    onSuccess: async () => {
      notify.success(t("disband.success"));
      await invalidate();
    },
    onError: failure,
  });

  const uploadImageMutation = useMutation({
    mutationFn: (file: File) => registrationTeamService.uploadImage(team.id, file),
    onSuccess: async () => {
      notify.success(t("myCard.logoSaved"));
      await invalidate();
    },
    onError: failure,
  });

  const deleteImageMutation = useMutation({
    mutationFn: () => registrationTeamService.deleteImage(team.id),
    onSuccess: async () => {
      notify.success(t("myCard.logoRemoved"));
      await invalidate();
    },
    onError: failure,
  });

  const busy =
    inviteMutation.isPending ||
    revokeMutation.isPending ||
    kickMutation.isPending ||
    transferMutation.isPending ||
    leaveMutation.isPending ||
    disbandMutation.isPending;

  const slotLabel = (code: string) => {
    const known = ROSTER_SLOT_CODES.find((candidate) => candidate === code);
    return known ? tSlot(known) : code;
  };

  /** Slots still worth offering. Derived from `open_slots` (which the server
   *  already strips of zero counts) so a full slot is not offerable — the server
   *  would answer `slot_taken`. */
  const offerableSlots = ROSTER_SLOT_CODES.filter((code) => (team.open_slots[code] ?? 0) > 0);
  const pendingInvites = team.invites.filter((invite) => invite.state === "pending");
  const benchOpen = team.max_substitutes - team.substitutes_used > 0;
  /** The crest is only writable while the roster still is: the server refuses a
   *  terminal or already-exported team with `team_not_forming` /
   *  `team_already_exported`, so offering the control would be a dead end. */
  const logoEditable =
    isCaptain &&
    team.exported_team_id == null &&
    (team.status === "forming" || team.status === "complete");

  return (
    <section className="grid gap-3 rounded-xl border border-[color:var(--aqt-border)] bg-[color:var(--aqt-overlay-1)] p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <EditableAvatar
            src={team.image_url}
            name={team.name}
            size={44}
            shape="rounded"
            editable={logoEditable}
            busy={uploadImageMutation.isPending || deleteImageMutation.isPending}
            onSelectFile={(file) => uploadImageMutation.mutate(file)}
            onDelete={team.image_url ? () => deleteImageMutation.mutate() : undefined}
            maxSizeBytes={MAX_AVATAR_BYTES}
            onError={(message) => notify.error(message)}
            labels={{
              change: t("create.logoChange"),
              upload: t("create.logoUpload"),
              edit: t("create.logoEdit"),
              drop: t("create.logoDrop"),
              remove: t("create.logoRemove"),
              unsupportedType: t("create.logoUnsupported"),
              tooLarge: t("create.logoTooLarge", {
                mb: Math.round(MAX_AVATAR_BYTES / (1024 * 1024)),
              }),
            }}
          />
          <div className="grid min-w-0 gap-0.5">
            <h3 className="truncate text-base font-semibold">{team.name}</h3>
            <p className="text-xs text-[color:var(--aqt-fg-muted)]">
              {team.is_complete
                ? t("list.complete")
                : t("list.shortfall", { slots: formatShortfall(team.open_slots, tSlot) })}
            </p>
          </div>
        </div>
        <span className="rounded-full border border-[color:var(--aqt-border-2)] px-2.5 py-0.5 text-xs">
          {t(`status.${team.status}`)}
        </span>
      </header>

      <ul className="grid gap-1.5">
        {team.members.map((member) => (
          <li
            key={member.registration_id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-[color:var(--aqt-border)] px-3 py-2 text-sm"
          >
            <span className="font-medium">{member.display_name ?? member.battle_tag}</span>
            {member.slot_code && (
              <span className="text-xs text-[color:var(--aqt-fg-muted)]">
                {slotLabel(member.slot_code)}
              </span>
            )}
            {member.is_captain && (
              <span className="inline-flex items-center gap-1 text-xs text-[color:var(--aqt-amber)]">
                <Crown className="size-3.5" aria-hidden />
                {t("member.captain")}
              </span>
            )}
            {member.is_substitute && (
              <span className="text-xs text-[color:var(--aqt-fg-muted)]">
                {t("member.substitute")}
              </span>
            )}
            {isCaptain && !member.is_captain && (
              <span className="ml-auto flex gap-1">
                {!member.is_substitute && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      const name = member.display_name ?? member.battle_tag ?? "";
                      if (!window.confirm(t("member.makeCaptainConfirm", { name }))) return;
                      transferMutation.mutate(member.registration_id);
                    }}
                  >
                    <Crown className="size-3.5" aria-hidden />
                    {t("member.makeCaptain")}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    const name = member.display_name ?? member.battle_tag ?? "";
                    if (!window.confirm(t("member.kickConfirm", { name }))) return;
                    kickMutation.mutate(member.registration_id);
                  }}
                >
                  <UserMinus className="size-3.5" aria-hidden />
                  {t("member.kick")}
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>

      {isCaptain && (
        <div className="grid gap-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--aqt-fg-muted)]">
            {t("invite.title")}
          </span>
          {pendingInvites.length === 0 ? (
            <p className="text-xs text-[color:var(--aqt-fg-muted)]">{t("invite.pendingEmpty")}</p>
          ) : (
            <ul className="grid gap-1.5">
              {pendingInvites.map((invite) => (
                <li
                  key={invite.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-[color:var(--aqt-border-2)] px-3 py-2 text-sm"
                >
                  <span>{slotLabel(invite.slot_code)}</span>
                  {invite.is_substitute && (
                    <span className="text-xs text-[color:var(--aqt-fg-muted)]">
                      {t("member.substitute")}
                    </span>
                  )}
                  <span className="text-xs text-[color:var(--aqt-fg-muted)]">
                    {t(`inviteState.${invite.state}`)}
                  </span>
                  {invite.expires_at && (
                    <span className="text-xs text-[color:var(--aqt-fg-muted)]">
                      {t("invite.expiresAt", {
                        date: new Date(invite.expires_at).toLocaleDateString(),
                      })}
                    </span>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    disabled={busy}
                    onClick={() => revokeMutation.mutate(invite.id)}
                  >
                    {t("invite.revoke")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <footer className="flex flex-wrap gap-2">
        {isCaptain && (offerableSlots.length > 0 || benchOpen) && (
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => {
              setInviteSlot(offerableSlots[0] ?? null);
              setInviteSubstitute(offerableSlots.length === 0);
              setIssuedToken(null);
              setInviteOpen(true);
            }}
          >
            <UserPlus className="size-4" aria-hidden />
            {t("invite.action")}
          </Button>
        )}
        {isCaptain ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              if (!window.confirm(t("disband.confirm"))) return;
              disbandMutation.mutate();
            }}
          >
            <Trash2 className="size-4" aria-hidden />
            {t("disband.action")}
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              if (!window.confirm(t("member.leaveConfirm"))) return;
              leaveMutation.mutate();
            }}
          >
            <LogOut className="size-4" aria-hidden />
            {t("member.leave")}
          </Button>
        )}
      </footer>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>{t("invite.title")}</DialogTitle>

          {issuedToken ? (
            <div className="grid gap-2">
              <p className="text-sm font-medium">{t("invite.tokenTitle")}</p>
              <p className="text-xs text-warning">{t("invite.tokenHint")}</p>
              <code className="block overflow-x-auto rounded-lg border border-[color:var(--aqt-border)] bg-muted/30 px-3 py-2 text-xs">
                {issuedToken}
              </code>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(issuedToken);
                  notify.success(t("invite.copied"));
                }}
              >
                <Copy className="size-4" aria-hidden />
                {t("invite.copy")}
              </Button>
            </div>
          ) : (
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <span className="text-sm font-medium">{t("invite.slotLabel")}</span>
                <div className="flex flex-wrap gap-2">
                  {offerableSlots.map((code) => (
                    <button
                      key={code}
                      type="button"
                      aria-pressed={inviteSlot === code}
                      onClick={() => setInviteSlot(code)}
                      className={cn(
                        "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                        inviteSlot === code
                          ? "border-[color:var(--aqt-accent)] bg-[color:color-mix(in_srgb,var(--aqt-accent)_12%,transparent)]"
                          : "border-[color:var(--aqt-border)] hover:bg-muted/40",
                      )}
                    >
                      {slotLabel(code)}
                    </button>
                  ))}
                </div>
              </div>

              {benchOpen && (
                <Label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={inviteSubstitute}
                    onChange={(event) => setInviteSubstitute(event.target.checked)}
                  />
                  {t("invite.substituteLabel")}
                </Label>
              )}

              <Button
                type="button"
                disabled={busy || (!inviteSlot && !inviteSubstitute)}
                onClick={() => inviteMutation.mutate()}
              >
                {t("invite.submit")}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
