"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import type { WizardRegistrationState } from "../wizard-model";

// Status fields of the registration form. The full builder (custom fields,
// ordering) lives in the tournament's Settings › Registration; it is linked
// below once the lazy Unpublished draft exists (D4/D25).
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
  labelKey: "autoApprove" | "openProfile" | "subscription";
  descriptionKey: "autoApproveDescription" | "openProfileDescription" | "subscriptionDescription";
}> = [
  {
    key: "auto_approve",
    labelKey: "autoApprove",
    descriptionKey: "autoApproveDescription"
  },
  {
    key: "require_open_profile",
    labelKey: "openProfile",
    descriptionKey: "openProfileDescription"
  },
  {
    key: "require_subscription",
    labelKey: "subscription",
    descriptionKey: "subscriptionDescription"
  }
];

export function RegistrationStep({ value, onChange, draftId }: Readonly<RegistrationStepProps>) {
  const t = useTranslations("adminTournaments.registration");
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4">
        {ROWS.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label
                htmlFor={`wizard-registration-${row.key}`}
                className="cursor-pointer text-sm font-medium"
              >
                {t(row.labelKey)}
              </Label>
              <p className="text-xs text-muted-foreground">{t(row.descriptionKey)}</p>
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
          {t("formHelp")}
        </p>
        {draftId ? (
          <Button asChild type="button" variant="outline" size="sm">
            <Link href={`/admin/tournaments/${draftId}/settings/registration`}>
              {t("openFormBuilder")}
            </Link>
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("formDraftHelp")}
          </p>
        )}
      </div>
    </div>
  );
}
