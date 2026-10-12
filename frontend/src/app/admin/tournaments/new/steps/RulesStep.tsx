"use client";

import { Label } from "@/components/ui/label";
import { useTranslations } from "next-intl";
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import type { DivisionGridVersion } from "@/types/workspace.types";

import type { WizardFormData } from "../wizard-model";

// Field set mirrors the Rules & Grid + Scoring cards of TournamentSettingsTab;
// those cards are inline JSX in a monolithic form, so they are not reusable as-is.
interface RulesStepProps {
  value: WizardFormData;
  onChange: (next: WizardFormData) => void;
  divisionGridVersions: DivisionGridVersion[];
  divisionGridLoading: boolean;
}

export function RulesStep({
  value,
  onChange,
  divisionGridVersions,
  divisionGridLoading
}: Readonly<RulesStepProps>) {
  const t = useTranslations("adminTournaments.rules");
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="wizard-team-formation">{t("teamFormation")}</Label>
          <Select
            value={value.team_formation ?? "balancer"}
            onValueChange={(nextValue) => onChange({ ...value, team_formation: nextValue })}
          >
            <SelectTrigger id="wizard-team-formation" className="mt-1.5">
              <SelectValue placeholder={t("selectMethod")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="balancer">{t("formation.balancer")}</SelectItem>
              <SelectItem value="draft">{t("formation.draft")}</SelectItem>
              <SelectItem value="registration">{t("formation.registration")}</SelectItem>
              <SelectItem value="solo">{t("formation.solo")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="wizard-division-grid-version">{t("divisionGridVersion")}</Label>
          <Select
            value={value.division_grid_version_id?.toString() ?? "none"}
            onValueChange={(nextValue) =>
              onChange({
                ...value,
                division_grid_version_id: nextValue === "none" ? null : Number(nextValue)
              })
            }
          >
            <SelectTrigger id="wizard-division-grid-version" className="mt-1.5">
              <SelectValue
                placeholder={divisionGridLoading ? t("loadingDivisionGrids") : t("selectVersion")}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("workspaceDefault")}</SelectItem>
              {divisionGridVersions.map((version) => (
                <SelectItem key={version.id} value={version.id.toString()}>
                  {version.label} (v{version.version}, {version.status})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-medium">{t("scoringPoints")}</h3>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label htmlFor="wizard-win-points">{t("win")}</Label>
            <NumberInput
              id="wizard-win-points"
              value={value.win_points ?? 1}
              onValueChange={(next) => onChange({ ...value, win_points: next ?? 0 })}
              className="mt-1.5 tabular-nums"
            />
          </div>
          <div>
            <Label htmlFor="wizard-draw-points">{t("draw")}</Label>
            <NumberInput
              id="wizard-draw-points"
              value={value.draw_points ?? 0.5}
              onValueChange={(next) => onChange({ ...value, draw_points: next ?? 0 })}
              className="mt-1.5 tabular-nums"
            />
          </div>
          <div>
            <Label htmlFor="wizard-loss-points">{t("loss")}</Label>
            <NumberInput
              id="wizard-loss-points"
              value={value.loss_points ?? 0}
              onValueChange={(next) => onChange({ ...value, loss_points: next ?? 0 })}
              className="mt-1.5 tabular-nums"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
