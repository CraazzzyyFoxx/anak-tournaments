"use client";

import { useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { notify } from "@/lib/notify";
import pickBanService from "@/services/pickBan.service";
import type {
  MapVetoMode,
  PickBanConfig,
  PickBanFirstBanRotation,
  PickBanFirstPickRule,
  PickBanKind,
  PickBanNoRepeatScope,
  PickBanSequenceToken,
} from "@/types/tournament.types";

interface PickBanConfigsTabProps {
  tournamentId: number;
  canManage: boolean;
}

const KIND_VALUES: PickBanKind[] = ["map", "hero"];
const MODE_VALUES: MapVetoMode[] = ["pool", "slots"];
const FIRST_PICK_RULE_VALUES: PickBanFirstPickRule[] = ["higher_seed"];
const FIRST_BAN_ROTATION_VALUES: PickBanFirstBanRotation[] = [
  "fixed",
  "alternate",
  "result_winner_first",
  "result_loser_first",
  "result_loser_choice",
];
const NO_REPEAT_SCOPE_VALUES: PickBanNoRepeatScope[] = ["none", "encounter", "encounter_same_side"];

interface DraftSlot {
  candidates: string;
  reserveItemId: string;
}

interface Draft {
  id: number | null;
  kind: PickBanKind;
  stageId: string;
  round: string;
  mode: MapVetoMode;
  firstPickRule: PickBanFirstPickRule;
  firstBanRotation: PickBanFirstBanRotation;
  turnTimerSeconds: string;
  preset: string;
  noRepeatScope: PickBanNoRepeatScope;
  uniqueAttribute: string;
  allowProtect: boolean;
  sequence: string;
  itemIds: string;
  slots: DraftSlot[];
}

function emptyDraft(kind: PickBanKind = "map"): Draft {
  return {
    id: null,
    kind,
    stageId: "",
    round: "",
    mode: "pool",
    firstPickRule: "higher_seed",
    firstBanRotation: "fixed",
    turnTimerSeconds: "",
    preset: "",
    noRepeatScope: "none",
    uniqueAttribute: "",
    allowProtect: false,
    sequence: "",
    itemIds: "",
    slots: [],
  };
}

function draftFromConfig(config: PickBanConfig): Draft {
  return {
    id: config.id,
    kind: config.kind,
    stageId: config.stage_id != null ? String(config.stage_id) : "",
    round: config.round != null ? String(config.round) : "",
    mode: config.mode,
    firstPickRule: config.first_pick_rule,
    firstBanRotation: config.first_ban_rotation,
    turnTimerSeconds: config.turn_timer_seconds != null ? String(config.turn_timer_seconds) : "",
    preset: config.preset ?? "",
    noRepeatScope: config.no_repeat_scope,
    uniqueAttribute: config.unique_attribute_per_side_per_round ?? "",
    allowProtect: config.allow_protect,
    sequence: config.sequence.join(","),
    itemIds: config.item_ids.join(","),
    slots: config.slots.map((slot) => ({
      candidates: slot.candidates.join(","),
      reserveItemId: slot.reserve_item_id != null ? String(slot.reserve_item_id) : "",
    })),
  };
}

function parseIntList(value: string): number[] {
  return value
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => Number(token))
    .filter((n) => Number.isFinite(n));
}

/** Free-text admin input, not yet validated against the token vocabulary —
 * the server rejects an invalid sequence on submit (`admin_pick_ban_config_upsert`). */
function parseTokenList(value: string): PickBanSequenceToken[] {
  return value
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0) as PickBanSequenceToken[];
}

/**
 * Admin CRUD for the generic `PickBanConfig` (map + hero kinds). Deliberately
 * simpler than `TournamentMapVetoTab`'s cascade-aware editor: one flat list
 * plus an inline form, since the cascade (stage/round) is still a plain
 * numeric override here rather than a resolved tree view. Design:
 * docs/plans/2026-08-09-generic-pickban-engine.md.
 */
export function PickBanConfigsTab({ tournamentId, canManage }: PickBanConfigsTabProps) {
  const t = useTranslations("pickBan.admin");
  const queryClient = useQueryClient();
  const configsQueryKey = ["admin", "tournament", tournamentId, "pick-ban-configs"] as const;

  const configsQuery = useQuery({
    queryKey: configsQueryKey,
    queryFn: () => pickBanService.listConfigs(tournamentId),
  });

  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PickBanConfig | null>(null);

  const upsertMutation = useMutation({
    mutationFn: (input: Draft) =>
      pickBanService.upsertConfig(tournamentId, {
        kind: input.kind,
        stage_id: input.stageId ? Number(input.stageId) : null,
        round: input.round ? Number(input.round) : null,
        mode: input.mode,
        first_pick_rule: input.firstPickRule,
        first_ban_rotation: input.firstBanRotation,
        preset: input.preset || null,
        turn_timer_seconds: input.turnTimerSeconds ? Number(input.turnTimerSeconds) : null,
        no_repeat_scope: input.noRepeatScope,
        unique_attribute_per_side_per_round: input.uniqueAttribute || null,
        allow_protect: input.allowProtect,
        sequence: input.mode === "pool" ? parseTokenList(input.sequence) : [],
        item_ids: input.mode === "pool" ? parseIntList(input.itemIds) : [],
        slots:
          input.mode === "slots"
            ? input.slots.map((slot) => ({
                candidates: parseIntList(slot.candidates),
                reserve_item_id: slot.reserveItemId ? Number(slot.reserveItemId) : null,
              }))
            : [],
      }),
    onSuccess: () => {
      notify.success(t("save"));
      setDraft(null);
    },
    onError: (error) => notify.apiError(error, { title: t("saveFailed") }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: configsQueryKey }),
  });

  const deleteMutation = useMutation({
    mutationFn: (configId: number) => pickBanService.deleteConfig(configId),
    onSuccess: () => {
      notify.success(t("deleted"));
      setDeleteTarget(null);
    },
    onError: (error) => notify.apiError(error, { title: t("deleteFailed") }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: configsQueryKey }),
  });

  const configsByKind = useMemo(() => {
    const byKind: Record<PickBanKind, PickBanConfig[]> = { map: [], hero: [] };
    for (const config of configsQuery.data?.configs ?? []) byKind[config.kind].push(config);
    return byKind;
  }, [configsQuery.data]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="font-onest text-lg font-semibold">{t("title")}</h2>
        {canManage ? (
          <Button size="sm" onClick={() => setDraft(emptyDraft())}>
            <Plus className="mr-2 h-4 w-4" aria-hidden />
            {t("addConfig")}
          </Button>
        ) : null}
      </div>

      {KIND_VALUES.map((kind) => (
        <Card key={kind}>
          <CardHeader>
            <CardTitle className="text-base">{kind === "map" ? t("kindMap") : t("kindHero")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {configsByKind[kind].length === 0 ? (
              <p className="text-sm text-[color:var(--aqt-fg-muted)]">{t("noConfigs")}</p>
            ) : (
              configsByKind[kind].map((config) => (
                <div
                  key={config.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-[color:var(--aqt-border)] px-3 py-2"
                >
                  <Badge variant="outline">{config.mode === "pool" ? t("modePool") : t("modeSlots")}</Badge>
                  <span className="text-sm">
                    {config.stage_id != null
                      ? `${t("stageLabel")} #${config.stage_id}${config.round != null ? ` · ${t("roundLabel")} ${config.round}` : ""}`
                      : t("tournamentLevel")}
                  </span>
                  {config.allow_protect ? <Badge variant="secondary">{t("allowProtect")}</Badge> : null}
                  <div className="ml-auto flex items-center gap-2">
                    {canManage ? (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setDraft(draftFromConfig(config))}>
                          {t("edit")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(config)}>
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      ))}

      {draft ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{draft.id != null ? t("save") : t("addConfig")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>{t("kindLabel")}</Label>
                <Select value={draft.kind} onValueChange={(v) => setDraft({ ...draft, kind: v as PickBanKind })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="map">{t("kindMap")}</SelectItem>
                    <SelectItem value="hero">{t("kindHero")}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{t("kindHint")}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t("modeLabel")}</Label>
                <Select value={draft.mode} onValueChange={(v) => setDraft({ ...draft, mode: v as MapVetoMode })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODE_VALUES.map((mode) => (
                      <SelectItem key={mode} value={mode}>
                        {mode === "pool" ? t("modePool") : t("modeSlots")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {draft.mode === "pool" ? t("modePoolHint") : t("modeSlotsHint")}
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t("stageLabel")}</Label>
                <Input
                  value={draft.stageId}
                  onChange={(e) => setDraft({ ...draft, stageId: e.target.value })}
                  placeholder={t("tournamentLevel")}
                />
                <p className="text-xs text-muted-foreground">{t("stageHint")}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t("roundLabel")}</Label>
                <Input value={draft.round} onChange={(e) => setDraft({ ...draft, round: e.target.value })} />
                <p className="text-xs text-muted-foreground">{t("roundHint")}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t("firstPickRule")}</Label>
                <Select
                  value={draft.firstPickRule}
                  onValueChange={(v) => setDraft({ ...draft, firstPickRule: v as PickBanFirstPickRule })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FIRST_PICK_RULE_VALUES.map((rule) => (
                      <SelectItem key={rule} value={rule}>
                        {t(`firstPickRuleValue.${rule}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{t("firstPickRuleHint")}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t("firstBanRotation")}</Label>
                <Select
                  value={draft.firstBanRotation}
                  onValueChange={(v) => setDraft({ ...draft, firstBanRotation: v as PickBanFirstBanRotation })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FIRST_BAN_ROTATION_VALUES.map((rotation) => (
                      <SelectItem key={rotation} value={rotation}>
                        {t(`firstBanRotationValue.${rotation}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{t(`firstBanRotationHint.${draft.firstBanRotation}`)}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t("noRepeatScope")}</Label>
                <Select
                  value={draft.noRepeatScope}
                  onValueChange={(v) => setDraft({ ...draft, noRepeatScope: v as PickBanNoRepeatScope })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NO_REPEAT_SCOPE_VALUES.map((scope) => (
                      <SelectItem key={scope} value={scope}>
                        {t(`noRepeatScopeValue.${scope}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{t(`noRepeatScopeHint.${draft.noRepeatScope}`)}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t("turnTimer")}</Label>
                <NumberInput
                  min={1}
                  integer
                  value={draft.turnTimerSeconds ? Number(draft.turnTimerSeconds) : null}
                  onValueChange={(v) => setDraft({ ...draft, turnTimerSeconds: v != null ? String(v) : "" })}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Switch
                  checked={draft.allowProtect}
                  onCheckedChange={(checked) => setDraft({ ...draft, allowProtect: checked })}
                />
                <Label>{t("allowProtect")}</Label>
              </div>
              <p className="text-xs text-muted-foreground">{t("allowProtectHint")}</p>
            </div>

            {draft.mode === "pool" ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label>{t("sequence")}</Label>
                  <Input
                    value={draft.sequence}
                    onChange={(e) => setDraft({ ...draft, sequence: e.target.value })}
                    placeholder="ban_first,ban_second,pick_first,pick_second,decider"
                  />
                  <p className="text-xs text-muted-foreground">{t("sequenceHint")}</p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t("itemIds")}</Label>
                  <Input
                    value={draft.itemIds}
                    onChange={(e) => setDraft({ ...draft, itemIds: e.target.value })}
                    placeholder="1,2,3,4,5,6,7"
                  />
                  <p className="text-xs text-muted-foreground">{t("itemIdsHint")}</p>
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-2">
                {draft.slots.map((slot, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={slot.candidates}
                      onChange={(e) => {
                        const slots = [...draft.slots];
                        slots[index] = { ...slots[index], candidates: e.target.value };
                        setDraft({ ...draft, slots });
                      }}
                      placeholder="candidate item ids, comma-separated"
                    />
                    <Input
                      value={slot.reserveItemId}
                      onChange={(e) => {
                        const slots = [...draft.slots];
                        slots[index] = { ...slots[index], reserveItemId: e.target.value };
                        setDraft({ ...draft, slots });
                      }}
                      placeholder="reserve id"
                      className="w-32"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDraft({ ...draft, slots: draft.slots.filter((_, i) => i !== index) })}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDraft({ ...draft, slots: [...draft.slots, { candidates: "", reserveItemId: "" }] })}
                >
                  <Plus className="mr-2 h-4 w-4" aria-hidden />
                  {t("addConfig")}
                </Button>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button disabled={upsertMutation.isPending} onClick={() => upsertMutation.mutate(draft)}>
                {upsertMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
                {upsertMutation.isPending ? t("saving") : t("save")}
              </Button>
              <Button variant="ghost" onClick={() => setDraft(null)}>
                {t("cancel")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <DeleteConfirmDialog
        open={deleteTarget != null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("deleteConfirm")}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
        }}
        isDeleting={deleteMutation.isPending}
      />
    </div>
  );
}
