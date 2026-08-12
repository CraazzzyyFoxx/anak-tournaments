"use client";

import { useState } from "react";
import { Loader2, RotateCcw, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { notify } from "@/lib/notify";
import adminService from "@/services/admin.service";
import type { PickBanAction, PickBanKind, PickBanState } from "@/types/tournament.types";

import type { PickBanSide } from "@/components/pick-ban/pick-ban-model";

interface PregameAdminControlsProps {
  kind: PickBanKind;
  encounterId: number;
  state: PickBanState;
  allowProtect: boolean;
  selectedItemId: number | null;
  selectedItemName: string | null;
  onMutated: () => void;
}

/**
 * Workspace-admin overrides: reset the whole pick-ban session (drop +
 * re-create with seeds re-resolved) and perform a step on behalf of either
 * side. Generalizes the retired `VetoAdminControls` with `kind` and the
 * `protect` action the generic engine adds.
 */
export function PregameAdminControls({
  kind,
  encounterId,
  state,
  allowProtect,
  selectedItemId,
  selectedItemName,
  onMutated
}: PregameAdminControlsProps) {
  const t = useTranslations("pickBan.room");
  const defaultSide: PickBanSide = state.turn_side ?? "home";
  const defaultAction: PickBanAction =
    state.expected_action === "pick"
      ? "pick"
      : state.expected_action === "protect"
        ? "protect"
        : "ban";
  // The override is stored WITH the step it was made for, so a new step
  // automatically falls back to what the sequence expects.
  const step = state.current_step_index;
  const [override, setOverride] = useState<{
    step: number | null;
    side: PickBanSide;
    action: PickBanAction;
  } | null>(null);
  const isOverridden = override?.step === step;
  const side = isOverridden ? override.side : defaultSide;
  const action = isOverridden ? override.action : defaultAction;
  const setSide = (next: PickBanSide) => setOverride({ step, side: next, action });
  const setAction = (next: PickBanAction) => setOverride({ step, side, action: next });

  const resetMutation = useMutation({
    mutationFn: () => adminService.resetPickBanSession(encounterId, kind),
    onSuccess: () => {
      notify.success(t("admin.resetSuccess"));
      onMutated();
    },
    onError: (error) => notify.apiError(error, { title: t("admin.resetFailed") })
  });

  const actMutation = useMutation({
    mutationFn: (input: { side: PickBanSide; item_id: number; action: PickBanAction }) =>
      adminService.adminPickBanAct(encounterId, { kind, ...input }),
    onSuccess: onMutated,
    onError: (error) => notify.apiError(error, { title: t("admin.actFailed") })
  });

  const canAct = state.session?.status === "active" && !state.is_complete && selectedItemId != null;
  const pending = resetMutation.isPending || actMutation.isPending;

  const actionOptions: { value: PickBanAction; label: string }[] = [
    { value: "ban", label: t("action.ban") },
    { value: "pick", label: t("action.pick") },
    ...(allowProtect ? [{ value: "protect" as const, label: t("action.protect") }] : [])
  ];

  return (
    <section className="rounded-xl border border-dashed border-[color:var(--aqt-amber)]/45 bg-[color:var(--aqt-card-2)]/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-[color:var(--aqt-amber)]" aria-hidden />
        <h2 className="text-sm font-semibold">{t("admin.title")}</h2>
      </div>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        {state.session?.status === "active" && !state.is_complete ? (
          <>
            <ChoiceGroup
              label={t("admin.sideLabel")}
              options={[
                { value: "home", label: t("side.home") },
                { value: "away", label: t("side.away") }
              ]}
              value={side}
              onChange={setSide}
            />
            <ChoiceGroup
              label={t("admin.actionLabel")}
              options={actionOptions}
              value={action}
              onChange={setAction}
            />
            <Button
              size="sm"
              disabled={!canAct || pending}
              onClick={() => {
                if (selectedItemId == null) return;
                actMutation.mutate({ side, item_id: selectedItemId, action });
              }}
            >
              {actMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              {t("admin.confirm")}
              {selectedItemName ? `: ${selectedItemName}` : ""}
            </Button>
            {selectedItemId == null ? (
              <span className="text-xs text-[color:var(--aqt-fg-muted)]">
                {t("admin.selectItemFirst")}
              </span>
            ) : null}
          </>
        ) : null}

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="destructive" disabled={pending} className="ml-auto">
              {resetMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
              )}
              {t("admin.reset")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("admin.resetConfirmTitle")}</AlertDialogTitle>
              <AlertDialogDescription>{t("admin.resetConfirmHint")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("captain.cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => resetMutation.mutate()}>
                {t("admin.resetConfirmAction")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </section>
  );
}

function ChoiceGroup<TValue extends string>({
  label,
  options,
  value,
  onChange
}: {
  label: string;
  options: { value: TValue; label: string }[];
  value: TValue;
  onChange: (value: TValue) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--aqt-fg-faint)]">
        {label}
      </span>
      <div className="flex gap-1">
        {options.map((option) => (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={option.value === value ? "default" : "outline"}
            className={cn("capitalize", option.value === value ? "pointer-events-none" : null)}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
