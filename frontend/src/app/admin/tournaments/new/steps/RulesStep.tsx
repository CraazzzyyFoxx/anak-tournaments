"use client";

import { Label } from "@/components/ui/label";
import { useTranslations } from "next-intl";
import { NumberInput } from "@/components/ui/number-input";

import type { WizardFormData } from "../wizard-model";

interface RulesStepProps {
  value: WizardFormData;
  onChange: (next: WizardFormData) => void;
}

/**
 * Scoring points. Team formation and the division grid are asked once, on
 * Basics: the Schedule step that follows already needs the formation to know
 * whether a draft phase exists.
 */
export function RulesStep({ value, onChange }: Readonly<RulesStepProps>) {
  const t = useTranslations("adminTournaments.rules");
  return (
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
  );
}
