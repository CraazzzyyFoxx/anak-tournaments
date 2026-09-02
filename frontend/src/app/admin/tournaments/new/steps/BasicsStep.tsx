"use client";

import { TournamentFormFields } from "@/components/admin/tournaments/TournamentFormFields";
import type { DivisionGridVersion } from "@/types/workspace.types";

import type { WizardFormData, WizardSource } from "../wizard-model";

interface BasicsStepProps {
  source: WizardSource;
  value: WizardFormData;
  onChange: (next: WizardFormData) => void;
  challongeSlug: string;
  onChallongeSlugChange: (slug: string) => void;
  divisionGridVersions: DivisionGridVersion[];
  divisionGridLoading: boolean;
}

/**
 * Step 1. The source is picked by the `?source=` link in the wizard's `aside`
 * (F16), not by tabs inside the step: importing from Challonge is an
 * alternative entry to this same wizard, so it must be linkable.
 */
export function BasicsStep({
  source,
  value,
  onChange,
  challongeSlug,
  onChallongeSlugChange,
  divisionGridVersions,
  divisionGridLoading
}: Readonly<BasicsStepProps>) {
  const challonge = source === "challonge";
  return (
    <TournamentFormFields
      idPrefix="wizard"
      mode={challonge ? "challonge-create" : "manual-create"}
      value={value}
      onChange={onChange}
      challongeSlugValue={challonge ? challongeSlug : undefined}
      onChallongeSlugValueChange={challonge ? onChallongeSlugChange : undefined}
      divisionGridVersions={divisionGridVersions}
      divisionGridLoading={divisionGridLoading}
    />
  );
}
