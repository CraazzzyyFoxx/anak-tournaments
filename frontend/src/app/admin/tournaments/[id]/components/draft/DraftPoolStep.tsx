"use client";

import { AlertTriangle, CheckCircle2, Link2Off, ShieldAlert, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";

import { StatTile, StatTileGrid } from "@/components/admin/StatTile";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { PageStateCard } from "@/components/ui/page-state-card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useSlotLabel } from "@/hooks/useSlotLabel";
import type { RoleOntology } from "@/lib/roster/ontology";
import type { DraftFeasibility } from "@/types/draft.types";

import { MAX_DRAFT_TEAM_COUNT, MIN_DRAFT_TEAM_COUNT, type DraftPoolReadiness } from "./setup-model";

interface DraftPoolStepProps {
  readiness: DraftPoolReadiness;
  feasibility?: DraftFeasibility | null;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  /** The team count in effect: the pinned one, else the pool's maximum. */
  teamCount: number;
  /** `maxDraftTeamCount` — how many teams this pool can fill at most. */
  maxTeamCount: number;
  /** False while the count follows the maximum. */
  pinned: boolean;
  /** A number pins the count; `null` follows the maximum again. */
  onTeamCountChange: (next: number | null) => void;
  locked?: boolean;
  /** The owner game's role dictionary: the names of the roles the pool must cover. */
  ontology: RoleOntology | null;
}

export function DraftPoolStep({
  readiness,
  feasibility,
  loading,
  failed,
  onRetry,
  teamCount,
  maxTeamCount,
  pinned,
  onTeamCountChange,
  locked = false,
  ontology
}: Readonly<DraftPoolStepProps>) {
  const t = useTranslations("draftAdmin");
  const slotLabel = useSlotLabel(ontology);
  const percent = readiness.requiredPlayers
    ? Math.min(100, Math.round((readiness.actualPlayers / readiness.requiredPlayers) * 100))
    : 0;

  if (loading) {
    return <Skeleton className="h-52 w-full rounded-xl" />;
  }
  if (failed) {
    return <PageStateCard state="error" description={t("poolLoadFailed")} onAction={onRetry} />;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">{t("poolPlayers")}</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">
              {readiness.actualPlayers}
              <span className="ml-1 text-base font-normal text-muted-foreground">
                / {readiness.requiredPlayers}
              </span>
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="draft-team-count">{t("teamCount")}</Label>
            <div className="flex items-center gap-2">
              <NumberInput
                id="draft-team-count"
                integer
                min={MIN_DRAFT_TEAM_COUNT}
                max={MAX_DRAFT_TEAM_COUNT}
                disabled={locked}
                value={teamCount}
                onValueChange={(next) => onTeamCountChange(next ?? MIN_DRAFT_TEAM_COUNT)}
                className="h-9 w-20 tabular-nums"
              />
              {!locked && pinned && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={() => onTeamCountChange(null)}
                >
                  {t("teamCountMax")}
                </Button>
              )}
            </div>
            <p className="text-xs tabular-nums text-muted-foreground">
              {t("teamCountMaxHint", { count: maxTeamCount })}
            </p>
          </div>
        </div>
        <Progress value={percent} className="mt-4 h-2" aria-label={t("poolPlayers")} />
      </div>

      <StatTileGrid className="sm:grid-cols-3 md:grid-cols-3 xl:grid-cols-3">
        <StatTile
          icon={AlertTriangle}
          label={t("missingRanks")}
          value={readiness.missingRanks}
          tone={readiness.missingRanks > 0 ? "warning" : "neutral"}
        />
        <StatTile
          icon={Link2Off}
          label={t("missingAccounts")}
          value={readiness.missingAccounts}
          tone={readiness.missingAccounts > 0 ? "warning" : "neutral"}
        />
        <StatTile icon={XCircle} label={t("excludedPlayers")} value={readiness.excludedPlayers} />
      </StatTileGrid>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">{t("roleCoverage")}</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          {Object.keys(readiness.roleCoverage).map((role) => {
            const blocked = readiness.blockers.includes(`role_shortage:${role}`);
            return (
              <div
                key={role}
                className="flex items-center justify-between rounded-xl border border-border px-4 py-3"
              >
                <span className="text-sm font-medium">{slotLabel(role)}</span>
                <span className="flex items-center gap-2">
                  <strong className="tabular-nums">{readiness.roleCoverage[role]}</strong>
                  {blocked ? (
                    <ShieldAlert
                      className="h-4 w-4 text-danger"
                      role="img"
                      aria-label={t("blocker")}
                    />
                  ) : (
                    <CheckCircle2
                      className="h-4 w-4 text-success"
                      role="img"
                      aria-label={t("ready")}
                    />
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {(readiness.blockers.length > 0 || (feasibility && !feasibility.is_feasible)) && (
        <Alert variant="destructive" className="rounded-xl">
          <ShieldAlert className="size-4" aria-hidden />
          <AlertTitle>{t("blockingIssues")}</AlertTitle>
          <AlertDescription>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              {readiness.blockers.map((blocker) => (
                <li key={blocker}>
                  {blocker.startsWith("role_shortage:")
                    ? t("blockers.role_shortage", { role: slotLabel(blocker.slice("role_shortage:".length)) })
                    : blocker === "pool_unranked"
                      ? t("blockers.pool_unranked", { count: readiness.missingRanks })
                      : t("blockers.not_enough_players")}
                </li>
              ))}
              {feasibility?.slot_deficits.map((deficit) => (
                <li key={deficit.slot_code}>
                  {t("roleDeficit", {
                    role: slotLabel(deficit.slot_code),
                    count: deficit.unmatched_slots
                  })}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
