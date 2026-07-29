"use client";

import { TournamentFormFields } from "@/components/admin/tournaments/TournamentFormFields";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DivisionGridVersion } from "@/types/workspace.types";

import type { WizardFormData, WizardSource } from "../wizard-model";

interface BasicsStepProps {
  source: WizardSource;
  onSourceChange: (source: WizardSource) => void;
  value: WizardFormData;
  onChange: (next: WizardFormData) => void;
  challongeSlug: string;
  onChallongeSlugChange: (slug: string) => void;
  divisionGridVersions: DivisionGridVersion[];
  divisionGridLoading: boolean;
}

export function BasicsStep({
  source,
  onSourceChange,
  value,
  onChange,
  challongeSlug,
  onChallongeSlugChange,
  divisionGridVersions,
  divisionGridLoading
}: BasicsStepProps) {
  return (
    <Tabs value={source} onValueChange={(next) => onSourceChange(next as WizardSource)}>
      <TabsList className="mb-4">
        <TabsTrigger value="manual">Manual</TabsTrigger>
        <TabsTrigger value="challonge">From Challonge</TabsTrigger>
      </TabsList>
      <TabsContent value="manual">
        <TournamentFormFields
          idPrefix="wizard-manual"
          mode="manual-create"
          value={value}
          onChange={onChange}
          divisionGridVersions={divisionGridVersions}
          divisionGridLoading={divisionGridLoading}
        />
      </TabsContent>
      <TabsContent value="challonge">
        <TournamentFormFields
          idPrefix="wizard-challonge"
          mode="challonge-create"
          value={value}
          onChange={onChange}
          challongeSlugValue={challongeSlug}
          onChallongeSlugValueChange={onChallongeSlugChange}
          divisionGridVersions={divisionGridVersions}
          divisionGridLoading={divisionGridLoading}
        />
      </TabsContent>
    </Tabs>
  );
}
