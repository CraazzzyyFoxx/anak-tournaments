"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import type { WizardRegistrationState } from "../wizard-model";

// Status fields of the registration form builder (hub registration/form).
// The full builder (custom fields, ordering) lives in the tournament hub;
// it is linked below once the lazy Unpublished draft exists (D4/D25).
interface RegistrationStepProps {
  value: WizardRegistrationState;
  onChange: (next: WizardRegistrationState) => void;
  /** Lazy draft id; the form builder link stays disabled until it exists. */
  draftId: number | null;
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

export function RegistrationStep({ value, onChange, draftId }: RegistrationStepProps) {
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Custom fields and built-in field configuration live in the form builder.
        </p>
        {draftId ? (
          <Button asChild type="button" variant="outline" size="sm">
            <Link href={`/admin/tournaments/${draftId}/registration/form`}>
              Open form builder
              <ExternalLink className="ml-2 h-3.5 w-3.5" aria-hidden />
            </Link>
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            The form builder opens once the draft is saved.
          </p>
        )}
      </div>
    </div>
  );
}
