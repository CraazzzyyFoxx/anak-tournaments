"use client";

import { useTranslations } from "next-intl";

import { SaveBar } from "@/components/kit/SaveBar";
import { SettingGroup } from "@/components/kit/SettingRow";
import type { Tournament } from "@/types/tournament.types";

import { DraftFormatFields } from "../../components/draft/DraftFormatFields";
import { resolveDraftFormat } from "../../components/draft/setup-model";
import { SettingsSectionPage } from "../SettingsSection";
import { useTournamentSettingsForm } from "../useTournamentSettingsForm";

export default function DraftSettingsPage() {
  const tPage = useTranslations("adminTournament.screenDescriptions");
  return (
    <SettingsSectionPage
      section="draft"
      description={tPage("draft")}
    >
      {({ tournament, tournamentId, canUpdateTournament }) => (
        <DraftFormatForm
          tournament={tournament}
          tournamentId={tournamentId}
          disabled={!canUpdateTournament}
        />
      )}
    </SettingsSectionPage>
  );
}

function DraftFormatForm({
  tournament,
  tournamentId,
  disabled
}: Readonly<{ tournament: Tournament; tournamentId: number; disabled: boolean }>) {
  const t = useTranslations("draftAdmin");
  const { form, patch, dirty, summary, saving, save, discard, error } = useTournamentSettingsForm(
    tournament,
    tournamentId,
    "draft"
  );
  // The server refuses the change while a draft is in flight, the same guard
  // the roster shape has: a session already copied the rule it drafts with.
  const locked = tournament.roster_locked_by_draft === true;
  const rounds = tournament.roster_shape?.draft_rounds ?? 0;
  const value = resolveDraftFormat(form.draft_format_json, rounds);

  return (
    <>
      <SettingGroup
        id="format"
        title={t("groups.format.title")}
        description={
          locked ? <span className="text-warning">{t("formatLockedByDraft")}</span> : undefined
        }
      >
        <DraftFormatFields
          value={value}
          rounds={rounds}
          disabled={disabled || locked}
          onChange={(next) => patch({ draft_format_json: next })}
        />
      </SettingGroup>

      <SaveBar dirty={dirty} summary={summary} error={error} saving={saving} onDiscard={discard} onSave={save} />
    </>
  );
}
