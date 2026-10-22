"use client";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

import DivisionIcon from "@/components/DivisionIcon";
import type { DivisionGrid } from "@/types/workspace.types";

import type { PlayerValidationIssue } from "@/components/balancer/workspace-helpers";

const CHIP_CLASS =
  "inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-300/20 bg-amber-500/10 px-1.5 py-0.5 text-label font-medium text-amber-100/80";

/** The full sentence for an issue: the chip's tooltip and the pool card's summary. */
export function useIssueMessage(): (issue: PlayerValidationIssue) => string {
  const t = useTranslations("balancerTool.pool.issues");

  return (issue) => {
    switch (issue.code) {
      case "missing_ranked_role":
        return t("message.missingRankedRole");
      case "status_blocks_ready":
        return t("message.statusBlocksReady");
      case "application_role_mismatch":
        return t("message.roleMismatch", {
          application: issue.applicationRoleLabels.join(" / ") || t("noRoles"),
          balancer: issue.playerRoleLabels.join(" / ") || t("noRoles")
        });
      case "rank_delta_warning":
        return t("message.rankDelta", {
          role: issue.roleLabel,
          current: issue.currentLabel,
          ow: issue.owLabel,
          delta: issue.delta
        });
    }
  };
}

/**
 * Stable React key for an issue chip. Rank-delta warnings can occur once per role,
 * so the role is folded in to keep keys unique within a player's chip list.
 */
export function issueChipKey(issue: PlayerValidationIssue): string {
  return issue.code === "rank_delta_warning" ? `${issue.code}-${issue.role}` : issue.code;
}

/**
 * Amber validation chip. For rank-delta warnings it renders a compact icon form
 * (role · current-division-icon → ow-division-icon · Δpts); the full text is in the tooltip.
 */
export function IssueChip({
  issue,
  divisionGrid,
}: Readonly<{
  issue: PlayerValidationIssue;
  /** The owner game's grid the chip's division crests resolve in. */
  divisionGrid: DivisionGrid;
}>) {
  const t = useTranslations("balancerTool.pool.issues");
  const message = useIssueMessage()(issue);
  if (issue.code === "rank_delta_warning") {
    return (
      <span className={CHIP_CLASS} title={message}>
        <span className="font-semibold uppercase tracking-label">{issue.roleLabel}</span>
        {issue.currentDivision != null ? (
          <DivisionIcon division={issue.currentDivision} tournamentGrid={divisionGrid} width={14} height={14} />
        ) : null}
        <ArrowRight className="size-4 shrink-0 opacity-70" aria-hidden />
        {issue.owDivision != null ? (
          <DivisionIcon division={issue.owDivision} tournamentGrid={divisionGrid} width={14} height={14} />
        ) : null}
        <span className="tabular-nums">{t("deltaPoints", { delta: issue.delta })}</span>
      </span>
    );
  }

  return (
    <span className={CHIP_CLASS} title={message}>
      {issue.code === "missing_ranked_role"
        ? t("missingRankedRole")
        : issue.code === "status_blocks_ready"
          ? t("statusBlocksReady")
          : t("roleMismatch")}
    </span>
  );
}
