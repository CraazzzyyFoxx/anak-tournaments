"use client";

import { useTranslations } from "next-intl";

import { NumberInput } from "@/components/ui/number-input";
import { Switch } from "@/components/ui/switch";
import { SaveBar } from "@/components/kit/SaveBar";
import { SettingGroup, SettingRow } from "@/components/kit/SettingRow";
import type { Tournament } from "@/types/tournament.types";
import { SettingsSectionPage } from "../SettingsSection";
import { useTournamentSettingsForm } from "../useTournamentSettingsForm";

/**
 * What a result is worth, and the two flags that decide how the tournament is
 * counted: split out of the old "Rules & scoring" page, which mixed an
 * authored document with a points table nobody edits in the same sitting.
 */
export default function ScoringSettingsPage() {
  return (
    <SettingsSectionPage section="scoring">
      {({ tournament, tournamentId, canUpdateTournament }) => (
        <ScoringForm
          tournament={tournament}
          tournamentId={tournamentId}
          disabled={!canUpdateTournament}
        />
      )}
    </SettingsSectionPage>
  );
}

function ScoringForm({
  tournament,
  tournamentId,
  disabled
}: Readonly<{ tournament: Tournament; tournamentId: number; disabled: boolean }>) {
  const t = useTranslations("adminTournament.scoring");
  const { form, patch, dirty, summary, saving, save, discard, error } = useTournamentSettingsForm(
    tournament,
    tournamentId,
    "scoring"
  );

  return (
    <>
      <div className="flex flex-col gap-4">
        <SettingGroup id="points" title={t("points")}>
          <SettingRow htmlFor="settings-win-points" label={t("win")}>
            <NumberInput
              id="settings-win-points"
              value={form.win_points}
              disabled={disabled}
              onValueChange={(next) => patch({ win_points: next ?? 0 })}
              size="sm"
              className="w-24"
            />
          </SettingRow>
          <SettingRow htmlFor="settings-draw-points" label={t("draw")}>
            <NumberInput
              id="settings-draw-points"
              value={form.draw_points}
              disabled={disabled}
              onValueChange={(next) => patch({ draw_points: next ?? 0 })}
              size="sm"
              className="w-24"
            />
          </SettingRow>
          <SettingRow htmlFor="settings-loss-points" label={t("loss")}>
            <NumberInput
              id="settings-loss-points"
              value={form.loss_points}
              disabled={disabled}
              onValueChange={(next) => patch({ loss_points: next ?? 0 })}
              size="sm"
              className="w-24"
            />
          </SettingRow>
        </SettingGroup>

        <SettingGroup id="results" title={t("results")}>
          <SettingRow htmlFor="settings-is-league" label={t("league")}>
            <Switch
              id="settings-is-league"
              checked={form.is_league}
              disabled={disabled}
              onCheckedChange={(checked) => patch({ is_league: checked })}
            />
          </SettingRow>
          <SettingRow htmlFor="settings-is-finished" label={t("finished")}>
            <Switch
              id="settings-is-finished"
              checked={form.is_finished}
              disabled={disabled}
              onCheckedChange={(checked) => patch({ is_finished: checked })}
            />
          </SettingRow>
          <SettingRow
            htmlFor="settings-logs-official"
            label={t("logsOfficial")}
            hint={t("logsOfficialDescription")}
          >
            <Switch
              id="settings-logs-official"
              checked={form.logs_official}
              disabled={disabled}
              onCheckedChange={(checked) => patch({ logs_official: checked })}
            />
          </SettingRow>
        </SettingGroup>
      </div>

      <SaveBar dirty={dirty} summary={summary} error={error} saving={saving} onDiscard={discard} onSave={save} />
    </>
  );
}
