"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, LogIn, UserPlus, XCircle } from "lucide-react";
import Link from "next/link";

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { getCurrentPathForAuthRedirect } from "@/lib/auth-redirect";
import { cn } from "@/lib/utils";
import { isRegistrationOpen } from "@/lib/tournament-status";
import { useAuthProfile } from "@/hooks/useAuthProfile";
import { useAuthModalStore } from "@/stores/auth-modal.store";
import registrationService from "@/services/registration.service";
import type { Tournament } from "@/types/tournament.types";

import { useTranslations } from "next-intl";
import RegistrationWizard from "@/components/registration/RegistrationWizard";
import TeamRegistrationEntry from "@/components/registration/TeamRegistrationEntry";

type Props = {
  tournament: Tournament;
};

export default function TournamentRegisterButton({ tournament }: Readonly<Props>) {
  const workspaceId = tournament.workspace_id;
  const tournamentId = tournament.id;
  const tournamentName = tournament.name;
  const t = useTranslations();
  const { user, status: authStatus } = useAuthProfile();
  const openAuthModal = useAuthModalStore((state) => state.open);
  const isAuthenticated = authStatus === "authenticated" && user !== null;
  const [showModal, setShowModal] = useState(false);

  const formQuery = useQuery({
    queryKey: ["registration-form", workspaceId, tournamentId],
    queryFn: () => registrationService.getForm(tournamentId),
  });

  const myRegQuery = useQuery({
    queryKey: ["registration", workspaceId, tournamentId],
    queryFn: () => registrationService.getMyRegistration(tournamentId),
    enabled: isAuthenticated,
  });

  const form = formQuery.data;
  const myReg = myRegQuery.data;
  const handleAuthClick = () => {
    const nextPath =
      typeof window === "undefined"
        ? `/tournaments/${tournamentId}`
        : getCurrentPathForAuthRedirect(window.location);

    openAuthModal(nextPath);
  };

  if (formQuery.isLoading) return null;
  if (!form) return null;
  if (isAuthenticated && myRegQuery.isLoading) return null;

  // The form must exist (checked above) but no longer decides openness — the
  // tournament's REGISTRATION schedule window does.
  if (!isRegistrationOpen(tournament)) {
    return (
      <div className="inline-flex items-center gap-2 rounded-lg border border-[color:var(--aqt-border)] bg-[color:var(--aqt-overlay-1)] px-4 py-2 text-sm text-[color:var(--aqt-fg-dim)]">
        <Clock className="size-4" aria-hidden />
        {t("registration.button.closed")}
      </div>
    );
  }

  if (myReg) {
    const statusMap: Record<string, { icon: typeof Clock; label: string; className: string }> = {
      pending: {
        icon: Clock,
        label: t("common.pendingReview"),
        className:
          "border-[color:color-mix(in_srgb,var(--aqt-amber)_20%,transparent)] bg-[color:color-mix(in_srgb,var(--aqt-amber)_10%,transparent)] text-[color:var(--aqt-amber)]"
      },
      approved: {
        icon: CheckCircle2,
        label: t("common.approved"),
        className:
          "border-[color:color-mix(in_srgb,var(--aqt-emerald)_20%,transparent)] bg-[color:color-mix(in_srgb,var(--aqt-emerald)_10%,transparent)] text-[color:var(--aqt-emerald)]"
      },
      rejected: {
        icon: XCircle,
        label: t("common.rejected"),
        className:
          "border-[color:color-mix(in_srgb,var(--aqt-rose)_20%,transparent)] bg-[color:color-mix(in_srgb,var(--aqt-rose)_10%,transparent)] text-[color:var(--aqt-rose)]"
      },
      withdrawn: {
        icon: XCircle,
        label: t("common.withdrawn"),
        className:
          "border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-overlay-3)] text-[color:var(--aqt-fg-muted)]"
      }
    };
    const config = statusMap[myReg.status] ?? statusMap.pending;
    const StatusIcon = config.icon;
    return (
      <Link
        href={`/tournaments/${tournamentId}/participants`}
        className={cn(
          "inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-opacity hover:opacity-80",
          config.className
        )}
      >
        <StatusIcon className="size-4" aria-hidden />
        {config.label}
      </Link>
    );
  }

  if (!isAuthenticated) {
    return (
      <button
        type="button"
        onClick={handleAuthClick}
        className="inline-flex items-center gap-2 rounded-lg border border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-overlay-2)] px-4 py-2 text-sm font-medium text-[color:var(--aqt-fg-muted)] outline-none transition-colors hover:bg-[color:var(--aqt-overlay-3)] hover:text-[color:var(--aqt-fg)] focus-visible:ring-2 focus-visible:ring-[color:var(--aqt-teal)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--aqt-bg)]"
      >
        <LogIn className="size-4" aria-hidden />
        {t("registration.button.loginToRegister")}
      </button>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-[color:var(--aqt-teal)] px-4 py-2 text-sm font-medium text-[color:var(--aqt-bg)] outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[color:var(--aqt-teal)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--aqt-bg)]"
        >
          <UserPlus className="size-4" aria-hidden />
          {t("registration.button.register")}
        </button>

        {/* On a team-registration tournament both choices belong HERE, together.
            Registering solo first permanently forecloses founding a team (there is
            one registration row per player), so the fork has to be presented
            before either action is taken.

            A real button, not a link to the Teams tab: the primary action of a
            team tournament must not be a navigation step, and the tab rendered its
            own copy, which put two identical buttons on one screen. */}
        {tournament.team_formation === "registration" && (
          <TeamRegistrationEntry tournament={tournament} />
        )}
      </div>
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-2xl lg:max-w-3xl">
          <DialogTitle className="sr-only">
            {tournamentName ? t("registration.wizard.titleFor", { name: tournamentName }) : t("registration.wizard.title")}
          </DialogTitle>
          <RegistrationWizard
            workspaceId={workspaceId}
            tournamentId={tournamentId}
            tournamentName={tournamentName}
            form={form}
            onClose={() => setShowModal(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
