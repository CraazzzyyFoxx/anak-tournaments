"use client";

import { useTranslations } from "next-intl";

import { AchievementArt } from "@/components/achievements/AchievementArt";
import { InspectorField } from "@/components/kit/InspectorField";
import { SettingGroup } from "@/components/kit/SettingRow";
import type { AchievementRule } from "@/types/admin.types";

/** The rule's metadata, in the order an organizer reads it: what it is, then what it says. */
export function AchievementDetailsCard({
  rule,
  minTournamentName,
}: Readonly<{ rule: AchievementRule; minTournamentName?: string }>) {
  const t = useTranslations("adminAchievements");
  return (
    <SettingGroup id="details" title={t("detail.details")}>
      <div className="flex gap-6">
        <AchievementArt achievement={rule} sizes="64px" className="size-16 shrink-0 rounded-lg border" />
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-4 md:grid-cols-4">
          <InspectorField label={t("common.category")}>{t(`common.categoryValues.${rule.category}`)}</InspectorField>
          <InspectorField label={t("common.scope")}>{t(`common.scopeValues.${rule.scope}`)}</InspectorField>
          <InspectorField label={t("common.grain")}>{t(`common.grainValues.${rule.grain}`)}</InspectorField>
          <InspectorField label={t("common.version")}>
            <span className="tabular-nums">{rule.rule_version}</span>
          </InspectorField>
          <InspectorField label={t("common.minTournament")}>
            {rule.min_tournament_id != null &&
              (minTournamentName ?? t("common.tournamentId", { id: rule.min_tournament_id }))}
          </InspectorField>
          <InspectorField label={t("common.descriptionRu")} className="col-span-2">
            {rule.description_ru}
          </InspectorField>
          <InspectorField label={t("common.descriptionEn")} className="col-span-2">
            {rule.description_en}
          </InspectorField>
        </div>
      </div>
    </SettingGroup>
  );
}
