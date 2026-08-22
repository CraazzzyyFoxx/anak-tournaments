"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";

import { translateRegistrationTeamError } from "@/lib/registration-team-errors";
import { ROSTER_SLOT_CODES } from "@/lib/roster-shape";
import { tournamentQueryKeys } from "@/lib/tournament-query-keys";
import { cn } from "@/lib/utils";
import registrationTeamService from "@/services/registration-team.service";

interface InviteHistorySectionProps {
  workspaceId: number;
  teamId: number;
  expanded: boolean;
  onToggle: () => void;
}

/**
 * The states the server can send. Listed rather than inferred so an unrecognised
 * one renders as itself: a sixth state must not turn a row into a raw
 * `registrationTeams.history.state.<x>` key path.
 *
 * `RegistrationTeamsCard.tsx` keeps its own copy on purpose — the two sections are
 * deliberately uncoupled — and a test pins that the two lists agree.
 */
const HISTORY_STATES = ["pending", "accepted", "declined", "revoked", "expired"] as const;

/** How close to the ceiling still counts as a warning worth showing. */
const CAP_WARNING_MARGIN = 5;

/**
 * Every invite the team ever issued, plus the cap standing that explains a
 * refusal at the ceiling.
 *
 * Collapsed by default and the read is gated on `expanded`: the team payload
 * already carries the live invites, and this list only answers a question the
 * captain has to ask — was that offer declined, or did the link merely lapse?
 *
 * The parent owns `expanded` because it must force the panel open when an
 * invite is refused with `invite_cap_reached`.
 */
export default function InviteHistorySection({
  workspaceId,
  teamId,
  expanded,
  onToggle
}: Readonly<InviteHistorySectionProps>) {
  const t = useTranslations("registrationTeams");
  const tErrors = useTranslations("registrationTeams.errors");
  const tSlot = useTranslations("rosterShape.slotCodes");
  const panelId = useId();

  const historyQuery = useQuery({
    queryKey: tournamentQueryKeys.registrationInviteHistory(workspaceId, teamId),
    queryFn: () => registrationTeamService.listInviteHistory(teamId),
    enabled: expanded
  });

  const slotLabel = (code: string) => {
    const known = ROSTER_SLOT_CODES.find((candidate) => candidate === code);
    return known ? tSlot(known) : code;
  };

  const history = historyQuery.data;
  /** The warning lives in this header rather than in the invite dialog because
   *  the cap figures only exist once this section has been read, and the dialog
   *  would have to buy a second copy of them for every captain — including the
   *  many nowhere near the ceiling. The parent force-opens this panel on
   *  `invite_cap_reached`, so it is on screen at the one moment it decides
   *  anything. */
  const capNearby = history != null && history.cap_used >= history.cap_limit - CAP_WARNING_MARGIN;

  return (
    <div className="grid gap-2">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
        className="flex w-full items-center gap-2 text-left text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--aqt-fg-muted)] transition-colors hover:text-[color:var(--aqt-fg)]"
      >
        <ChevronDown
          className={cn("size-3.5 transition-transform", expanded && "rotate-180")}
          aria-hidden
        />
        {t("history.toggle")}
      </button>

      {expanded && (
        <div id={panelId} className="grid gap-2">
          {historyQuery.isError && (
            <p className="text-xs text-[color:var(--aqt-fg-muted)]">
              {translateRegistrationTeamError(tErrors, historyQuery.error)}
            </p>
          )}

          {history && (
            <div className="grid gap-0.5">
              <p className="text-xs text-[color:var(--aqt-fg-muted)]">
                {t("history.cap", { used: history.cap_used, limit: history.cap_limit })}
              </p>
              {/* Without this, "12 of 60" reads as the team's whole lifetime when
                  an organizer has already moved the counter's floor. */}
              {history.cap_reset_at && (
                <p className="text-xs text-[color:var(--aqt-fg-muted)]">
                  {t("history.capReset", {
                    date: new Date(history.cap_reset_at).toLocaleDateString()
                  })}
                </p>
              )}
              {capNearby && (
                <p className="text-xs text-[color:var(--aqt-amber)]">{t("history.capNearby")}</p>
              )}
            </div>
          )}

          {/* An expanded section with nothing in it must say so: a blank gap
              looks like a read that never finished. */}
          {history && history.items.length === 0 && (
            <p className="text-xs text-[color:var(--aqt-fg-muted)]">{t("history.empty")}</p>
          )}

          {history && history.items.length > 0 && (
            <ul className="grid gap-1.5">
              {/* Newest-first already, ordered by the server. */}
              {history.items.map((entry) => {
                // `.find` narrows to the literal union the typed translator
                // accepts; a membership test against a Record would not.
                const known = HISTORY_STATES.find((candidate) => candidate === entry.state);
                return (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-[color:var(--aqt-border)] px-3 py-2 text-sm"
                  >
                    <span>{known ? t(`history.state.${known}`) : entry.state}</span>
                    <span className="text-xs text-[color:var(--aqt-fg-muted)]">
                      {slotLabel(entry.slot_code)}
                    </span>
                    <span className="text-xs text-[color:var(--aqt-fg-muted)]">
                      {entry.target_battle_tag
                        ? t("invite.targetLabel", { name: entry.target_battle_tag })
                        : t("invite.linkLabel")}
                    </span>
                    {entry.is_substitute && (
                      <span className="text-xs text-[color:var(--aqt-fg-muted)]">
                        {t("member.substitute")}
                      </span>
                    )}
                    {entry.invited_at && (
                      <span className="text-xs text-[color:var(--aqt-fg-muted)]">
                        {t("history.issued", {
                          date: new Date(entry.invited_at).toLocaleDateString()
                        })}
                      </span>
                    )}
                    {entry.answered_at && (
                      <span className="text-xs text-[color:var(--aqt-fg-muted)]">
                        {t("history.answered", {
                          date: new Date(entry.answered_at).toLocaleDateString()
                        })}
                      </span>
                    )}
                    {/* Same `revoked` state, materially different event: the captain
                      did not do this one. */}
                    {entry.revoked_by_organizer && (
                      <span className="text-xs text-[color:var(--aqt-fg-muted)]">
                        {t("history.byOrganizer")}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
