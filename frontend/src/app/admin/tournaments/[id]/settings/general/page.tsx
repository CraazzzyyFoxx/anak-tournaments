"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AuditTrailButton } from "@/components/admin/AuditTrailSheet";
import { SaveBar } from "@/components/admin/kit/SaveBar";
import type { Tournament } from "@/types/tournament.types";
import { SettingsSectionPage } from "../SettingsSection";
import { useTournamentSettingsForm } from "../useTournamentSettingsForm";

export default function GeneralSettingsPage() {
  return (
    <SettingsSectionPage
      section="general"
      description="How this tournament is named and described."
    >
      {({ tournament, tournamentId, canUpdateTournament }) => (
        <GeneralForm
          tournament={tournament}
          tournamentId={tournamentId}
          disabled={!canUpdateTournament}
        />
      )}
    </SettingsSectionPage>
  );
}

function GeneralForm({
  tournament,
  tournamentId,
  disabled
}: Readonly<{ tournament: Tournament; tournamentId: number; disabled: boolean }>) {
  const { form, patch, dirty, summary, saving, save, discard } = useTournamentSettingsForm(
    tournament,
    tournamentId,
    "general"
  );

  return (
    <>
      {/* The audit trail is a drawer the whole admin shares, not a settings
          section of its own: it answers "who changed this" about every entity
          of the tournament, and General is the page the rail lands on. */}
      <div className="flex justify-end">
        <AuditTrailButton
          scope={{
            entityType: "tournament",
            entityId: tournamentId,
            workspaceId: tournament.workspace_id
          }}
          target={`tournament “${tournament.name}”`}
          showCount
        />
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settings-name">Tournament name</Label>
            <Input
              id="settings-name"
              value={form.name}
              disabled={disabled}
              onChange={(event) => patch({ name: event.target.value })}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settings-slug">Public URL slug</Label>
            <Input
              id="settings-slug"
              value={form.slug}
              disabled={disabled}
              onChange={(event) => patch({ slug: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Used in the public tournament URL. Changing it keeps the previous link working via a
              redirect.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settings-description">Description</Label>
            <Textarea
              id="settings-description"
              rows={4}
              value={form.description}
              disabled={disabled}
              placeholder="Optional tournament description…"
              onChange={(event) => patch({ description: event.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      <SaveBar dirty={dirty} summary={summary} saving={saving} onDiscard={discard} onSave={save} />
    </>
  );
}
