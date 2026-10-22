"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

import DivisionIcon from "@/components/DivisionIcon";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { usePermissions } from "@/hooks/usePermissions";
import { useRoleName } from "@/hooks/useRoleName";
import { getImpactColor } from "@/lib/colors";
import { useFormatter } from "@/lib/datetime/client";
import { findRole, type RoleOntology } from "@/lib/roster/ontology";
import { roleOf } from "@/lib/roster/role-ref";
import type { DivisionGridVersion } from "@/types/workspace.types";
import { type GlossaryTerm, isAnomalyGlossaryTerm } from "@/disciplines/overwatch/analytics/analytics-glossary";
import type { PlayerVM } from "@/disciplines/overwatch/analytics/useAnalyticsViewModel";

import AnomalyFlag, { useAnomalyCopy } from "../AnomalyFlag";
import { moveTone } from "../DeltaText";
import ExplanationPopover from "../ExplanationPopover";
import InfoDot from "../InfoDot";
import ChangeShiftDialog from "./ChangeShiftDialog";
import ImpactBar from "./ImpactBar";
import PlayerNick from "./PlayerNick";

const SECTION = "border-t border-[color:var(--aqt-border)] px-4 py-3";

interface PlayerDetailProps {
  player: PlayerVM;
  teamName: string;
  tournamentGrid?: DivisionGridVersion | null;
  /** The tournament's own role dictionary: the role's name and glyph come from it. */
  ontology: RoleOntology;
  canReadV2?: boolean;
  onExplain: (term: GlossaryTerm) => void;
}

/**
 * Player drill-down as one card: identity, the predicted move, impact and
 * confidence, the impact percentile, the watch flag, why the model says so,
 * and (organizers) the manual shift.
 */
export default function PlayerDetail({
  player,
  teamName,
  tournamentGrid,
  ontology,
  canReadV2 = false,
  onExplain
}: Readonly<PlayerDetailProps>) {
  const t = useTranslations();
  const format = useFormatter();
  const nameOf = useRoleName();
  const { hasPermission } = usePermissions();
  const [editing, setEditing] = useState(false);
  const canEdit = hasPermission("analytics.update");

  const direction = player.predicted_direction;
  const up = direction === "promote";
  const down = direction === "demote";
  const moveColor = moveTone(up ? 1 : down ? -1 : 0);
  const moveWord = up
    ? t("analytics.community.player.climb")
    : down
      ? t("analytics.community.player.drop")
      : t("analytics.community.player.hold");

  const roleCode = roleOf(player.role);
  const roleNode = findRole(ontology, player.role);
  const roleLabel = roleNode
    ? nameOf(roleNode)
    : roleCode === null || roleCode.toLowerCase() === "flex"
      ? t("common.roles.flex")
      : roleCode;
  const roleLower = roleLabel.toLowerCase();
  const confPct = Math.round(player.confidence * 100);
  const predictedDivision = player.predicted_division ?? player.division;

  const impactDesc =
    player.impact >= 80
      ? t("analytics.community.player.impactElite")
      : player.impact >= 50
        ? t("analytics.community.player.impactAbove")
        : player.impact >= 34
          ? t("analytics.community.player.impactMid")
          : t("analytics.community.player.impactBelow");
  const confDesc =
    player.confidence >= 0.8
      ? t("analytics.community.player.confidencePlenty")
      : player.confidence >= 0.6
        ? t("analytics.community.player.confidenceSolid")
        : t("analytics.community.player.confidenceThin");

  const flag = player.anomalies[0];
  // The kind is said in words from the glossary, never as the raw API value (DESIGN.md §11).
  const flagLabel = useAnomalyCopy(flag?.kind ?? "watch").label;
  const why: string[] = [];
  if (flag) {
    why.push(t("analytics.community.why.flag", { kind: flagLabel }));
    why.push(t("analytics.community.why.flagSignal", { pct: Math.round(flag.score * 100) }));
  } else if (up) {
    why.push(t("analytics.community.why.climbImpact", { division: player.division, role: roleLower }));
    why.push(t("analytics.community.why.climbConfidence", { pct: confPct }));
  } else if (down) {
    why.push(t("analytics.community.why.dropImpact", { division: player.division, role: roleLower }));
    why.push(t("analytics.community.why.dropConsistent", { maps: player.sample_matches }));
  } else {
    why.push(t("analytics.community.why.holdInBand", { division: player.division }));
    why.push(
      player.confidence < 0.6
        ? t("analytics.community.why.holdThin", { pct: confPct })
        : t("analytics.community.why.holdSteady")
    );
  }

  return (
    <Card className="overflow-hidden">
      <header className="flex items-center gap-3 px-4 py-4">
        <DivisionIcon division={player.division} tournamentGrid={tournamentGrid} width={48} height={48} tooltip />
        <div className="min-w-0">
          <h2>
            <PlayerNick player={player} className="text-heading font-semibold" />
          </h2>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-caption text-[color:var(--aqt-fg-muted)]">
            <PlayerRoleIcon role={player.role} ontology={ontology} size={14} decorative />
            <span className="truncate">
              {t("analytics.community.player.roleLine", {
                role: roleLabel,
                division: player.division,
                team: teamName
              })}
            </span>
          </p>
        </div>
      </header>

      <section className={SECTION}>
        <Eyebrow as="h3" className="flex items-center gap-0.5">
          {t("analytics.community.player.predictedMove")}
          <InfoDot term="predicted_move" onExplain={onExplain} />
        </Eyebrow>
        <div className="mt-1.5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-ui font-semibold" style={{ color: moveColor }}>
              {moveWord}
            </p>
            {direction !== "flat" ? (
              <p className="text-caption text-[color:var(--aqt-fg-muted)]">
                {t("analytics.community.player.divMove", { from: player.division, to: predictedDivision })}
              </p>
            ) : null}
          </div>
          {direction !== "flat" ? (
            <span className="flex shrink-0 items-center gap-1.5">
              <DivisionIcon division={player.division} tournamentGrid={tournamentGrid} width={32} height={32} tooltip />
              <ArrowRight aria-hidden className="size-4" style={{ color: moveColor }} />
              <DivisionIcon division={predictedDivision} tournamentGrid={tournamentGrid} width={36} height={36} tooltip />
            </span>
          ) : null}
        </div>
      </section>

      <dl className="grid grid-cols-2 border-t border-[color:var(--aqt-border)]">
        <div className="px-4 py-3">
          <Eyebrow as="dt" className="flex items-center gap-0.5">
            {t("analytics.community.player.impact")}
            <InfoDot term="impact" onExplain={onExplain} />
          </Eyebrow>
          <dd className="mt-1">
            <span
              className="aqt-tnum block font-onest text-title font-semibold"
              style={{ color: getImpactColor(player.impact) }}
            >
              {format.number(player.impact)}
            </span>
            <span className="text-caption text-[color:var(--aqt-fg-muted)]">{impactDesc}</span>
          </dd>
        </div>
        <div className="border-l border-[color:var(--aqt-border)] px-4 py-3">
          <Eyebrow as="dt" className="flex items-center gap-0.5">
            {t("analytics.community.player.confidence")}
            <InfoDot term="confidence" onExplain={onExplain} />
          </Eyebrow>
          <dd className="mt-1">
            <span className="aqt-tnum block font-onest text-title font-semibold text-[color:var(--aqt-fg)]">
              {format.number(player.confidence, { style: "percent", maximumFractionDigits: 0 })}
            </span>
            <span className="text-caption text-[color:var(--aqt-fg-muted)]">{confDesc}</span>
          </dd>
        </div>
      </dl>

      <section className={SECTION}>
        <div className="flex items-baseline justify-between gap-3">
          <Eyebrow as="h3">{t("analytics.community.player.percentileTitle")}</Eyebrow>
          <span className="text-caption text-[color:var(--aqt-fg-muted)]">
            {t("analytics.community.player.percentileVs", { division: player.division, role: roleLower })}
          </span>
        </div>
        {/* The figure is printed above; the bar places it on the 0–100 scale. */}
        <ImpactBar value={player.impact} showValue={false} className="mt-2" />
      </section>

      {flag ? (
        <section className={SECTION}>
          <h3 className="flex items-center gap-0.5">
            <AnomalyFlag kind={flag.kind} reasons={flag.reasons} label="full" />
            {isAnomalyGlossaryTerm(flag.kind) ? <InfoDot term={flag.kind} onExplain={onExplain} /> : null}
          </h3>
          <p className="mt-1 text-caption text-[color:var(--aqt-fg-muted)]">
            {t("analytics.community.player.flagBody", { kind: flagLabel })}
          </p>
        </section>
      ) : null}

      <section className={SECTION}>
        <div className="flex items-center justify-between gap-3">
          <Eyebrow as="h3">{t("analytics.community.player.whyTitle")}</Eyebrow>
          {canReadV2 ? <ExplanationPopover playerId={player.id} tournamentId={player.tournament_id} /> : null}
        </div>
        <ul className="mt-2 space-y-1.5">
          {why.map((line, index) => (
            <li key={index} className="flex gap-2 text-body text-[color:var(--aqt-fg-muted)]">
              <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-[color:var(--aqt-fg-dim)]" />
              {line}
            </li>
          ))}
        </ul>
      </section>

      {canEdit ? (
        <footer className={SECTION}>
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
            {t("analytics.standings.editManualShift")}
          </Button>
          <ChangeShiftDialog player={player} open={editing} onOpenChange={setEditing} />
        </footer>
      ) : null}
    </Card>
  );
}
