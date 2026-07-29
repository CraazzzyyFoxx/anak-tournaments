"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import type { WizardRegistrationState } from "../wizard-model";

// Status fields of the registration form builder (balancer/registrations/form).
// The full builder (custom fields, ordering) is linked from the hub after the
// tournament exists — TODO(T11): internal link to `{draftId}/registration/form`.
interface RegistrationStepProps {
  value: WizardRegistrationState;
  onChange: (next: WizardRegistrationState) => void;
}

const ROWS: Array<{
  key: keyof WizardRegistrationState;
  label: string;
  description: string;
}> = [
  {
    key: "is_open",
    label: "Open registration",
    description: "Players can submit the registration form."
  },
  {
    key: "auto_approve",
    label: "Auto-approve registrations",
    description: "New registrations skip the manual review queue."
  },
  {
    key: "require_open_profile",
    label: "Require open profile",
    description: "Players must keep their game profile public to register."
  }
];

export function RegistrationStep({ value, onChange }: RegistrationStepProps) {
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 bg-muted/20 border border-border/50 rounded-lg p-3.5">
        {ROWS.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label
                htmlFor={`wizard-registration-${row.key}`}
                className="cursor-pointer text-sm font-medium"
              >
                {row.label}
              </Label>
              <p className="text-xs text-muted-foreground">{row.description}</p>
            </div>
            <Switch
              id={`wizard-registration-${row.key}`}
              checked={value[row.key]}
              onCheckedChange={(checked) => onChange({ ...value, [row.key]: checked })}
            />
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        The full registration form builder (custom fields, built-in field configuration) opens
        from the tournament hub after creation.
      </p>
    </div>
  );
}
