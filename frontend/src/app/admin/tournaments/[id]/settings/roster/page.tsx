"use client";

import { SaveBar } from "@/components/admin/kit/SaveBar";
import { RosterShapeEditor } from "@/components/roster-shape/RosterShapeEditor";
import { payloadTotalError } from "@/components/roster-shape/roster-shape-editor.model";
import type { Tournament } from "@/types/tournament.types";
import { SettingsSectionPage } from "../SettingsSection";
import { useTournamentSettingsForm } from "../useTournamentSettingsForm";

export default function RosterSettingsPage() {
  return (
    <SettingsSectionPage
      section="roster"
      description="How many players of each role a team of this tournament fields."
    >
      {({ tournament, tournamentId, canUpdateTournament }) => (
        <RosterForm
          tournament={tournament}
          tournamentId={tournamentId}
          disabled={!canUpdateTournament}
        />
      )}
    </SettingsSectionPage>
  );
}

function RosterForm({
  tournament,
  tournamentId,
  disabled
}: Readonly<{ tournament: Tournament; tournamentId: number; disabled: boolean }>) {
  const { form, patch, dirty, summary, saving, save, discard } = useTournamentSettingsForm(
    tournament,
    tournamentId,
    "roster"
  );

  // The server rejects an out-of-range total with a 422. The editor already
  // says which way it is wrong; the save bar only has to refuse to send it.
  const totalError = payloadTotalError(form.roster_slots_json);

  return (
    <>
      <RosterShapeEditor
        value={form.roster_slots_json}
        effective={tournament.roster_shape}
        locked={tournament.roster_locked_by_draft === true}
        disabled={disabled}
        onChange={(next) => patch({ roster_slots_json: next })}
      />

      <SaveBar
        dirty={dirty}
        summary={totalError ? "The roster total above is out of range" : summary}
        saving={saving}
        onDiscard={discard}
        onSave={() => {
          if (!totalError) save();
        }}
      />
    </>
  );
}
