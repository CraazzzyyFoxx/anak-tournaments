"use client";

import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { EYEBROW_CLASS } from "@/components/kit/tone";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { notify } from "@/lib/notify";
import adminService from "@/services/admin.service";
import type { SeedRanking, Stage, StageItem } from "@/types/tournament.types";

import {
  BRACKET_STAGE_TYPES,
  GROUP_STAGE_TYPES,
  projectedBracketSeedCounts,
  qualifyingSourceStage,
  SEED_RANKING_LABELS,
  SEED_RANKING_LABEL_KEYS
} from "@/lib/bracket/projection";
import { Spinner } from "@/components/ui/spinner";
import type { SectionProps } from "./types";

export function SeedingSection({
  stage,
  form,
  onChange,
  onChanged,
  stages = []
}: SectionProps & { onChanged: () => void; stages?: Stage[] }) {
  const t = useTranslations("adminBracket.settings");
  const tRoot = useTranslations("adminBracket");
  const ids = useId();
  const isBracket = BRACKET_STAGE_TYPES.includes(form.stageType);
  const isGroups = !isBracket;
  const groups = stage.items.filter((item) => item.type === "group");
  const sources = stages.filter(
    (candidate) =>
      candidate.id !== stage.id &&
      GROUP_STAGE_TYPES.includes(candidate.stage_type) &&
      candidate.order < form.order
  );
  // Stages arrive async and the phase is editable, so the pick is derived, not
  // remembered: an unset (or no longer offered) choice falls back to the only
  // source there is.
  const [pickedSourceId, setPickedSourceId] = useState("");
  const sourceId = sources.some((source) => String(source.id) === pickedSourceId)
    ? pickedSourceId
    : sources.length === 1
      ? String(sources[0].id)
      : "";
  // How the advancing teams split across upper/lower is the server's rule
  // (per-group `advance_count` / `advance_upper_count` included); this only
  // says WHICH stage feeds the bracket.
  const wireMutation = useMutation({
    mutationFn: (sourceStageId: number) => adminService.autoWireStage(stage.id, sourceStageId),
    onSuccess: () => {
      onChanged();
      notify.success(t("wireSuccess"));
    },
    onError: (error) =>
      notify.apiError(error, { title: t("wireError") })
  });

  // Per-group overrides are stage_item rows, not stage form fields: they PATCH
  // on blur instead of waiting for "Save changes", which is why they carry
  // their own draft state rather than living in `form`.
  const [advanceDrafts, setAdvanceDrafts] = useState<Record<number, number | null>>({});
  const [upperDrafts, setUpperDrafts] = useState<Record<number, number | null>>({});
  const advanceMutation = useMutation({
    mutationFn: ({ stageItemId, advanceCount }: { stageItemId: number; advanceCount: number | null }) =>
      adminService.updateStageItem(stageItemId, { advance_count: advanceCount }),
    onSuccess: (_item, variables) => {
      setAdvanceDrafts((current) => {
        const next = { ...current };
        delete next[variables.stageItemId];
        return next;
      });
      onChanged();
    },
    onError: (error) =>
      notify.apiError(error, { title: t("advanceError") })
  });
  const upperMutation = useMutation({
    mutationFn: ({ stageItemId, upperCount }: { stageItemId: number; upperCount: number | null }) =>
      adminService.updateStageItem(stageItemId, { advance_upper_count: upperCount }),
    onSuccess: (_item, variables) => {
      setUpperDrafts((current) => {
        const next = { ...current };
        delete next[variables.stageItemId];
        return next;
      });
      onChanged();
    },
    onError: (error) =>
      notify.apiError(error, { title: t("upperError") })
  });

  const commitAdvance = (item: StageItem) => {
    if (!(item.id in advanceDrafts)) return;
    const next = advanceDrafts[item.id];
    if (next === (item.advance_count ?? null)) {
      setAdvanceDrafts((current) => {
        const rest = { ...current };
        delete rest[item.id];
        return rest;
      });
      return;
    }
    advanceMutation.mutate({ stageItemId: item.id, advanceCount: next });
  };

  const commitUpper = (item: StageItem) => {
    if (!(item.id in upperDrafts)) return;
    const next = upperDrafts[item.id];
    if (next === (item.advance_upper_count ?? null)) {
      setUpperDrafts((current) => {
        const rest = { ...current };
        delete rest[item.id];
        return rest;
      });
      return;
    }
    upperMutation.mutate({ stageItemId: item.id, upperCount: next });
  };

  // What the groups below will actually seed, read off the playoff they feed —
  // with the unsaved numbers already in place, so the line answers the field
  // being typed into rather than the last save.
  const projected = stages.map((candidate) =>
    candidate.id === stage.id
      ? {
          ...candidate,
          advance_count: form.advanceCount === "" ? null : Number(form.advanceCount),
          advance_upper_count:
            form.advanceUpperCount === "" ? null : Number(form.advanceUpperCount)
        }
      : candidate
  );
  // The playoff whose source really IS this stage: a later bracket in another
  // division resolves to its own groups, and saying what IT is seeded with
  // would be someone else's numbers.
  const nextPlayoff = projected
    .filter(
      (candidate) =>
        BRACKET_STAGE_TYPES.includes(candidate.stage_type) &&
        qualifyingSourceStage(candidate, projected)?.id === stage.id
    )
    .sort((left, right) => left.order - right.order || left.id - right.id)[0];
  const seeds = nextPlayoff ? projectedBracketSeedCounts(nextPlayoff, projected) : null;

  return (
    <div className="flex flex-col gap-4">
      {isBracket && sources.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-feed`}>{t("wireFrom")}</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={sourceId} onValueChange={setPickedSourceId}>
              <SelectTrigger id={`${ids}-feed`} className="sm:w-[280px]">
                <SelectValue placeholder={t("groupStage")} />
              </SelectTrigger>
              <SelectContent>
                {sources.map((source) => (
                  <SelectItem key={source.id} value={String(source.id)}>
                    {source.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!sourceId || wireMutation.isPending}
              onClick={() => wireMutation.mutate(Number(sourceId))}
            >
              {wireMutation.isPending ? (
                <Spinner />
              ) : null}
              {t("wire")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("wireHelp")}
          </p>
        </div>
      ) : null}

      {isBracket ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-seed-ranking`}>{t("bracketSeeds")}</Label>
          <Select
            value={form.seedRanking}
            onValueChange={(value) => onChange({ seedRanking: value as SeedRanking })}
          >
            <SelectTrigger id={`${ids}-seed-ranking`} className="sm:w-[320px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SEED_RANKING_LABELS) as SeedRanking[]).map((value) => (
                <SelectItem key={value} value={value}>
                  {tRoot(`labels.seedRanking.${SEED_RANKING_LABEL_KEYS[value]}` as never)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {t("seedHelp")}
          </p>
        </div>
      ) : null}

      {isGroups ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-advance`}>{t("advanceLabel")}</Label>
          <NumberInput
            id={`${ids}-advance`}
            integer
            min={1}
            placeholder={t("advancePlaceholder")}
            className="sm:w-[280px]"
            value={form.advanceCount === "" ? null : Number(form.advanceCount)}
            onValueChange={(next) => onChange({ advanceCount: next == null ? "" : String(next) })}
          />
          <p className="text-xs text-muted-foreground">
            {t("advanceHelp")}
          </p>

          <Label htmlFor={`${ids}-advance-upper`} className="mt-2">
            {t("advanceUpperLabel")}
          </Label>
          <NumberInput
            id={`${ids}-advance-upper`}
            integer
            min={0}
            placeholder={t("all")}
            className="sm:w-[280px]"
            value={form.advanceUpperCount === "" ? null : Number(form.advanceUpperCount)}
            onValueChange={(next) =>
              onChange({ advanceUpperCount: next == null ? "" : String(next) })
            }
          />
          <p className="text-xs text-muted-foreground">
            {t("advanceUpperHelp")}
          </p>
        </div>
      ) : null}

      {isGroups && groups.length > 0 ? (
        <div className="flex flex-col gap-1.5 border-t border-border pt-3">
          <p className={EYEBROW_CLASS}>{t("advancePerGroup")}</p>
          {groups.map((item) => (
            <div key={item.id} className="flex items-center gap-2">
              <Label
                htmlFor={`${ids}-advance-${item.id}`}
                className="w-40 shrink-0 truncate text-xs text-muted-foreground"
              >
                {item.name}
              </Label>
              <NumberInput
                id={`${ids}-advance-${item.id}`}
                integer
                min={1}
                size="sm"
                className="w-28 tabular-nums"
                placeholder={stage.advance_count != null ? tRoot("extra.inherit", { value: stage.advance_count }) : undefined}
                value={item.id in advanceDrafts ? advanceDrafts[item.id] : item.advance_count ?? null}
                onValueChange={(next) =>
                  setAdvanceDrafts((current) => ({ ...current, [item.id]: next }))
                }
                onBlur={() => commitAdvance(item)}
              />
              <Label
                htmlFor={`${ids}-upper-${item.id}`}
                className="shrink-0 text-xs text-muted-foreground"
              >
                {t("upper")}
              </Label>
              <NumberInput
                id={`${ids}-upper-${item.id}`}
                integer
                min={0}
                size="sm"
                className="w-28 tabular-nums"
                placeholder={tRoot("extra.inherit", { value: stage.advance_upper_count ?? t("all") })}
                value={
                  item.id in upperDrafts ? upperDrafts[item.id] : item.advance_upper_count ?? null
                }
                onValueChange={(next) =>
                  setUpperDrafts((current) => ({ ...current, [item.id]: next }))
                }
                onBlur={() => commitUpper(item)}
              />
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            {t("overrideHelp")}
          </p>
        </div>
      ) : null}

      {isGroups && seeds && seeds.lower > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("seedSplit", { name: nextPlayoff?.name, upper: seeds.upper, lower: seeds.lower })}
        </p>
      ) : null}

      <p className="border-t border-border pt-3 text-xs text-muted-foreground">
        {t("fillHelp")}
      </p>
    </div>
  );
}
