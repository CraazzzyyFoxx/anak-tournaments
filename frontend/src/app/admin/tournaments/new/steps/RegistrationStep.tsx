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

/** Every registration setting the wizard offers is a boolean now: the subscription
 *  rule itself belongs to the workspace, not to one tournament. */
type BooleanRegistrationKey = {
  [K in keyof WizardRegistrationState]: WizardRegistrationState[K] extends boolean ? K : never;
}[keyof WizardRegistrationState];

const ROWS: Array<{
  key: BooleanRegistrationKey;
  label: string;
  description: string;
}> = [
  {
    key: "auto_approve",
    label: "Auto-approve registrations",
    description: "New registrations skip the manual review queue."
  },
  {
    key: "require_open_profile",
    label: "Require open profile",
    description: "Players must keep their game profile public to register."
  },
  {
    key: "require_subscription",
    label: "Require an active subscription",
    description: "Checked at check-in only; an undetermined verdict fails open."
  }
];

export function RegistrationStep({ value, onChange, draftId }: Readonly<RegistrationStepProps>) {
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

      {value.require_subscription && (
        <p className="text-xs text-muted-foreground bg-muted/20 border border-border/50 rounded-lg p-3.5">
          Which providers and tiers count is configured once per workspace, in Admin →
          Subscription collection → Providers. Every tournament in the workspace enforces the
          same rule; this toggle only decides whether it is enforced here.
        </p>
      )}
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
