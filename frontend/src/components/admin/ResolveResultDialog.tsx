"use client";

import { useId, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, History } from "lucide-react";
import { useFormatter } from "@/lib/datetime/client";

import { AdminReportPairCell } from "@/components/admin/AdminReportPairCell";
import { ConfirmDialog } from "@/components/kit/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { notify } from "@/lib/notify";
import adminService from "@/services/admin.service";
import type { EncounterReportsRow, EncounterSetResultInput } from "@/types/admin.types";
import { EYEBROW_CLASS } from "@/components/kit/tone";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { encounterQueryKeys } from "@/lib/encounters/query-keys";
import { stageNeedsWinner } from "@/lib/encounter/score";
import { reportOf, scoreline } from "@/lib/encounter/reports";
import { seatsBySlot } from "@/lib/encounter/seats";

/**
 * How the score is decided: one participation's report is adopted (its
 * `encounter_team_id`, as a string) or the score is typed (`"manual"`). Mirrors
 * the server's resolution order so what the dialog previews is what the server
 * stores — the two must not drift.
 */
type Mode = string;

export interface ResolveResultDialogProps {
  row: EncounterReportsRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Invalidations the caller owns — the dialog does not know its surroundings. */
  onResolved?: () => void;
}

/**
 * The single admin write surface for an encounter result.
 *
 * Score, status, result_status and the audit row move together in one request,
 * so a dispute can never be left half-resolved the way "edit the score, then
 * confirm" could. An already-confirmed encounter offers Reopen instead: the
 * server refuses a second confirmation, and a disabled button would leave no
 * way forward.
 */
export function ResolveResultDialog({
  row,
  open,
  onOpenChange,
  onResolved
}: Readonly<ResolveResultDialogProps>) {
  const format = useFormatter();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");

  const isConfirmed = row?.result_status === "confirmed";

  const auditQuery = useQuery({
    queryKey: encounterQueryKeys.resultAudit(row?.id),
    queryFn: () => adminService.getEncounterResultAudit(row!.id),
    enabled: open && historyOpen && row != null
  });

  const resolveMutation = useMutation({
    mutationFn: (payload: EncounterSetResultInput) => adminService.setEncounterResult(row!.id, payload),
    onSuccess: () => {
      notify.success("Result confirmed");
      onOpenChange(false);
      onResolved?.();
    },
    onError: (error: unknown) => notify.apiError(error, { title: "Could not confirm the result" })
  });

  const reopenMutation = useMutation({
    mutationFn: () => adminService.reopenEncounterResult(row!.id, reopenReason.trim()),
    onSuccess: () => {
      notify.success("Result reopened");
      setReopenOpen(false);
      onOpenChange(false);
      onResolved?.();
    },
    onError: (error: unknown) => notify.apiError(error, { title: "Could not reopen the result" })
  });

  if (!row) return null;

  const seatIds = seatsBySlot(row.participations).map((seat) => seat.encounter_team_id);

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setHistoryOpen(false);
          onOpenChange(next);
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{isConfirmed ? "Result confirmed" : "Resolve result"}</DialogTitle>
            <DialogDescription>
              {row.name} &middot; {row.stage_name ?? "Unassigned"} &middot; BO{row.best_of}
            </DialogDescription>
          </DialogHeader>

          <AdminReportPairCell
            participations={row.participations}
            reports={row.reports}
            standingsMatch={row.standings_match}
            seriesScoreValid={row.series_score_valid}
          />

          {isConfirmed ? (
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                This result is already confirmed. Reopen it to replay or re-report the encounter.
              </p>
              <Label htmlFor="reopen-reason">Reason to reopen</Label>
              <Input
                id="reopen-reason"
                value={reopenReason}
                maxLength={500}
                onChange={(event) => setReopenReason(event.target.value)}
                placeholder="Why this result is reopened"
              />
            </div>
          ) : (
            // Keyed by encounter: switching rows must start from that row's
            // evidence, and a `key` does that without an effect that writes
            // state on every open.
            <ResolveForm
              key={row.id}
              row={row}
              pending={resolveMutation.isPending}
              onConfirm={(payload) => resolveMutation.mutate(payload)}
            />
          )}

          <div className="rounded-lg border border-border/60">
            <button
              type="button"
              className={cn(EYEBROW_CLASS, "flex w-full items-center gap-2 p-2 text-left")}
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen((current) => !current)}
            >
              <History className="size-3.5" aria-hidden />
              Change history
              <ChevronDown
                className={`ml-auto size-3.5 transition-transform ${historyOpen ? "rotate-180" : ""}`}
                aria-hidden
              />
            </button>
            {historyOpen ? (
              <div className="border-t border-border/60 p-2">
                {auditQuery.isLoading ? (
                  <p className="text-xs text-muted-foreground">Loading&hellip;</p>
                ) : (auditQuery.data?.length ?? 0) === 0 ? (
                  // Encounters that predate the audit trail have nothing to
                  // show; saying so beats an empty box that reads as a failure.
                  <p className="text-xs text-muted-foreground">No recorded changes.</p>
                ) : (
                  <ul className="space-y-1">
                    {auditQuery.data!.map((entry) => (
                      <li key={entry.id} className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{entry.action}</span> by{" "}
                        {entry.actor_name ?? "an automated process"} &middot;{" "}
                        <span className="font-mono tabular-nums">
                          {scoreline(entry.after, seatIds)}
                        </span>{" "}
                        &middot;{" "}
                        {format.dateTime(new Date(entry.created_at), {
                          dateStyle: "medium",
                          timeStyle: "short"
                        })}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </div>

          {isConfirmed ? (
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={reopenReason.trim() === ""}
                onClick={() => setReopenOpen(true)}
              >
                Reopen
              </Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={reopenOpen}
        onOpenChange={setReopenOpen}
        intent={{
          title: "Reopen this result?",
          description:
            "The encounter leaves the confirmed state and stops counting toward standings until it is confirmed again. Any bracket progression it drove is reset.",
          confirmLabel: "Reopen",
          tone: "warning"
        }}
        pending={reopenMutation.isPending}
        onConfirm={() => reopenMutation.mutate()}
      />
    </>
  );
}

/**
 * The score decision. Split out and mounted with a `key` so each encounter gets
 * a fresh form: the alternative is an effect that resets five pieces of state
 * whenever the row changes, which fights React instead of using it.
 */
function ResolveForm({
  row,
  pending,
  onConfirm
}: Readonly<{
  row: EncounterReportsRow;
  pending: boolean;
  onConfirm: (payload: EncounterSetResultInput) => void;
}>) {
  const modeFieldId = useId();
  const seats = seatsBySlot(row.participations);
  const seatIds = seats.map((seat) => seat.encounter_team_id);
  // A duel's standing is whole games; a lobby's is points, which may be fractional.
  const wholeScores = seats.length === 2;
  // Preselect the first seat with evidence. When only one captain has reported
  // that report is all there is, so defaulting to manual entry would make the
  // commonest case the most laborious.
  const firstReport = seats.map((seat) => reportOf(row.reports, seat.encounter_team_id)).find((report) => report);
  const [mode, setMode] = useState<Mode>(firstReport ? String(firstReport.encounter_team_id) : "manual");
  const [scores, setScores] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      seatIds.map((id) => [
        id,
        String(firstReport?.results.find((line) => line.encounter_team_id === id)?.score ?? "")
      ])
    )
  );
  const [closeness, setCloseness] = useState("");
  // The journal's line for this decision; the server refuses a result without one.
  const [reason, setReason] = useState("");

  const adopted = mode === "manual" ? null : (reportOf(row.reports, Number(mode)) ?? null);
  const preview = (() => {
    if (adopted) {
      return seatIds.map(
        (id) => adopted.results.find((line) => line.encounter_team_id === id)?.score ?? 0
      );
    }
    const entered = seatIds.map((id) => scores[id] ?? "");
    if (entered.some((value) => value.trim() === "")) return null;
    const numbers = entered.map(Number);
    return numbers.every(
      (value) => Number.isFinite(value) && value >= 0 && (!wholeScores || Number.isInteger(value))
    )
      ? numbers
      : null;
  })();

  // An elimination bracket needs a winner and the finalizer rejects a draw with
  // a 400. Blocking here means the admin learns it while the score is still in
  // front of them, rather than after a round trip.
  const drawBlocked =
    preview != null &&
    wholeScores &&
    preview[0] === preview[1] &&
    stageNeedsWinner(row.stage_type);

  const closenessNumber = closeness === "" ? null : Number(closeness);
  const closenessInvalid =
    closenessNumber != null &&
    (!Number.isInteger(closenessNumber) || closenessNumber < 1 || closenessNumber > 10);

  const options: Array<{ value: Mode; label: string; disabled: boolean; detail: string }> = [
    ...seats.map((seat) => {
      const report = reportOf(row.reports, seat.encounter_team_id);
      return {
        value: String(seat.encounter_team_id),
        label: `Adopt ${seat.name} report`,
        disabled: report == null,
        detail: report ? scoreline(report.results, seatIds) : "no report filed"
      };
    }),
    { value: "manual", label: "Enter the score manually", disabled: false, detail: "" }
  ];

  function submit() {
    const closenessField = closenessNumber ?? undefined;
    if (adopted) {
      // `adopt_report_team_id` rather than the numbers it happens to hold: the
      // audit records whose report was believed, not just the standing.
      onConfirm({
        reason: reason.trim(),
        results: [],
        adopt_report_team_id: adopted.encounter_team_id,
        closeness: closenessField
      });
      return;
    }
    onConfirm({
      reason: reason.trim(),
      results: seatIds.map((id, index) => ({ encounter_team_id: id, score: preview?.[index] ?? 0 })),
      closeness: closenessField
    });
  }

  return (
    <>
      <fieldset className="space-y-2">
        <legend
          id={`${modeFieldId}-legend`}
          className={EYEBROW_CLASS}
        >
          Which score is right?
        </legend>
        {/* `aria-labelledby` rather than a repeated `aria-label`: the legend is
            already on screen, and duplicating it would announce it twice. */}
        <RadioGroup
          value={mode}
          onValueChange={(next) => setMode(next)}
          aria-labelledby={`${modeFieldId}-legend`}
        >
          {options.map((option) => (
            <div
              key={option.value}
              className="flex items-center gap-2 data-[disabled=true]:opacity-50"
              data-disabled={option.disabled}
            >
              <RadioGroupItem
                id={`${modeFieldId}-${option.value}`}
                value={option.value}
                disabled={option.disabled}
              />
              {/* `<button>` is a labelable element, so `htmlFor` both names the
                  radio and makes the whole row its hit target. */}
              <Label
                htmlFor={`${modeFieldId}-${option.value}`}
                className="flex flex-wrap items-center gap-2 font-normal"
              >
                <span>{option.label}</span>
                {option.detail ? (
                  <span className="font-mono text-xs text-muted-foreground">{option.detail}</span>
                ) : null}
              </Label>
            </div>
          ))}
        </RadioGroup>

        {mode === "manual" ? (
          <div className="flex flex-wrap items-end gap-2 pt-1">
            {seats.map((seat) => (
              <div key={seat.encounter_team_id} className="space-y-1">
                <Label htmlFor={`${modeFieldId}-score-${seat.encounter_team_id}`}>{seat.name}</Label>
                <Input
                  id={`${modeFieldId}-score-${seat.encounter_team_id}`}
                  inputMode={wholeScores ? "numeric" : "decimal"}
                  className="h-8 w-20"
                  value={scores[seat.encounter_team_id] ?? ""}
                  onChange={(event) =>
                    setScores((current) => ({ ...current, [seat.encounter_team_id]: event.target.value }))
                  }
                />
              </div>
            ))}
          </div>
        ) : null}

        <div className="space-y-1 pt-1">
          <Label htmlFor="resolve-closeness">Closeness override (1&ndash;10, optional)</Label>
          <Input
            id="resolve-closeness"
            inputMode="numeric"
            className="h-8 w-20"
            value={closeness}
            onChange={(event) => setCloseness(event.target.value)}
            placeholder="auto"
            aria-invalid={closenessInvalid}
          />
          <p className="text-xs text-muted-foreground">
            Left blank, the encounter takes the average of the filed reports.
          </p>
        </div>

        <div className="space-y-1 pt-1">
          <Label htmlFor={`${modeFieldId}-reason`}>Reason</Label>
          <Input
            id={`${modeFieldId}-reason`}
            value={reason}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why this result is set"
          />
          <p className="text-xs text-muted-foreground">Required. Recorded in the result journal.</p>
        </div>
      </fieldset>

      <p className="text-sm" aria-live="polite">
        {preview ? (
          <>
            Will record{" "}
            <span className="font-mono font-semibold tabular-nums">{preview.join(" \u2013 ")}</span>
          </>
        ) : (
          <span className="text-muted-foreground">No score selected yet.</span>
        )}
        {drawBlocked ? (
          <span className="block text-danger">
            An elimination bracket needs a winner &mdash; a draw cannot be recorded here.
          </span>
        ) : null}
        {closenessInvalid ? (
          <span className="block text-danger">Closeness must be a whole number from 1 to 10.</span>
        ) : null}
      </p>

      <DialogFooter>
        <Button
          type="button"
          disabled={
            preview == null || drawBlocked || closenessInvalid || reason.trim() === "" || pending
          }
          onClick={submit}
        >
          {pending ? <Spinner /> : null}
          Confirm result
        </Button>
      </DialogFooter>
    </>
  );
}
