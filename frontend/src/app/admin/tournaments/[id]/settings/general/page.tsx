"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { Card, CardContent } from "@/components/ui/card";
import { EditableAvatar } from "@/components/ui/editable-avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AuditTrailButton } from "@/components/kit/AuditTrailSheet";
import { SaveBar } from "@/components/kit/SaveBar";
import { MAX_AVATAR_BYTES } from "@/lib/uploads";
import { notify } from "@/lib/notify";
import adminService from "@/services/admin.service";
import type { Tournament, TournamentImageSlot } from "@/types/tournament.types";
import { flattenDivisionGridVersions, useHubDivisionGridsQuery } from "../../hubQueries";
import { SettingsSectionPage } from "../SettingsSection";
import { useTournamentSettingsForm } from "../useTournamentSettingsForm";
import { invalidateTournamentWorkspace } from "@/lib/tournament/workspace-query-keys";

export default function GeneralSettingsPage() {
  const t = useTranslations("adminTournament.general");
  return (
    <SettingsSectionPage
      section="general"
      description={t("description")}
    >
      {({ tournament, tournamentId, workspaceId, canUpdateTournament }) => (
        <GeneralForm
          tournament={tournament}
          tournamentId={tournamentId}
          workspaceId={workspaceId}
          disabled={!canUpdateTournament}
        />
      )}
    </SettingsSectionPage>
  );
}

function GeneralForm({
  tournament,
  tournamentId,
  workspaceId,
  disabled
}: Readonly<{
  tournament: Tournament;
  tournamentId: number;
  workspaceId: number;
  disabled: boolean;
}>) {
  const t = useTranslations("adminTournament.general");
  const { form, patch, dirty, summary, saving, save, discard } = useTournamentSettingsForm(
    tournament,
    tournamentId,
    "general"
  );
  // Only this section reads the grid list, which is why the hub shell does not
  // fetch it on every tab load.
  const gridsQuery = useHubDivisionGridsQuery(tournamentId, workspaceId);
  const versions = flattenDivisionGridVersions(gridsQuery.data);

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
            <Label htmlFor="settings-name">{t("name")}</Label>
            <Input
              id="settings-name"
              value={form.name}
              disabled={disabled}
              onChange={(event) => patch({ name: event.target.value })}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settings-slug">{t("slug")}</Label>
            <Input
              id="settings-slug"
              value={form.slug}
              disabled={disabled}
              onChange={(event) => patch({ slug: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              {t("slugHint")}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settings-description">{t("descriptionLabel")}</Label>
            <Textarea
              id="settings-description"
              rows={4}
              value={form.description}
              disabled={disabled}
              placeholder={t("descriptionPlaceholder")}
              onChange={(event) => patch({ description: event.target.value })}
            />
          </div>

          <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="settings-team-formation">{t("formation")}</Label>
              <Select
                value={form.team_formation}
                disabled={disabled}
                onValueChange={(value) => patch({ team_formation: value })}
              >
                <SelectTrigger id="settings-team-formation">
                  <SelectValue placeholder={t("formationPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="balancer">{t("balancer")}</SelectItem>
                  <SelectItem value="draft">{t("liveDraft")}</SelectItem>
                  <SelectItem value="registration">{t("teamRegistration")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t("formationHint")}</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="settings-division-grid-version">{t("divisionGrid")}</Label>
              <Select
                value={form.division_grid_version_id?.toString() ?? "none"}
                disabled={disabled}
                onValueChange={(value) =>
                  patch({ division_grid_version_id: value === "none" ? null : Number(value) })
                }
              >
                <SelectTrigger id="settings-division-grid-version">
                  <SelectValue
                    placeholder={gridsQuery.isLoading ? t("loadingDivisionGrids") : t("selectVersion")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("workspaceDefault")}</SelectItem>
                  {versions.map((version) => (
                    <SelectItem key={version.id} value={version.id.toString()}>
                      {version.label} (v{version.version}, {version.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <BrandingCard tournament={tournament} tournamentId={tournamentId} disabled={disabled} />

      <SaveBar dirty={dirty} summary={summary} saving={saving} onDiscard={discard} onSave={save} />
    </>
  );
}

/**
 * The cover banner and the logo.
 *
 * Deliberately outside the `SaveBar` flow: images are not part of
 * `TournamentUpdate`, they travel as multipart to their own endpoint. Holding a
 * `File` in dirty-tracked form state would mean reconciling a failed upload
 * with a succeeded PATCH on every save, so the picker uploads immediately.
 */
function BrandingCard({
  tournament,
  tournamentId,
  disabled
}: Readonly<{ tournament: Tournament; tournamentId: number; disabled: boolean }>) {
  const t = useTranslations("adminTournament.general");
  const queryClient = useQueryClient();

  // Same invalidation the settings form uses: the cover also renders on the
  // public tournament page, so refreshing only the admin query would leave the
  // previous banner up until a reload.
  const upload = useMutation({
    mutationFn: ({ slot, file }: { slot: TournamentImageSlot; file: File }) =>
      adminService.uploadTournamentImage(tournamentId, slot, file),
    onSuccess: () => invalidateTournamentWorkspace(queryClient, tournamentId),
    onError: (error) => notify.apiError(error, { title: t("uploadError") })
  });

  const remove = useMutation({
    mutationFn: (slot: TournamentImageSlot) =>
      adminService.deleteTournamentImage(tournamentId, slot),
    onSuccess: () => invalidateTournamentWorkspace(queryClient, tournamentId),
    onError: (error) => notify.apiError(error, { title: t("removeImageError") })
  });

  const busy = upload.isPending || remove.isPending;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <div className="flex flex-col gap-1.5">
          <Label>{t("branding")}</Label>
          <p className="text-xs text-muted-foreground">
            {t("brandingHint")}
          </p>
        </div>

        <div className="flex flex-wrap items-start gap-8">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">{t("cover")}</span>
            <EditableAvatar
              src={tournament.cover_image_url}
              name={tournament.name}
              size={96}
              width={288}
              shape="rounded"
              editable={!disabled}
              busy={busy}
              onSelectFile={(file) => upload.mutate({ slot: "cover", file })}
              onDelete={tournament.cover_image_url ? () => remove.mutate("cover") : undefined}
              maxSizeBytes={MAX_AVATAR_BYTES}
              onError={(message) => notify.error(message)}
              disabled={disabled}
            />
            <p className="text-xs text-muted-foreground">
              {t("coverHint")}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">{t("logo")}</span>
            <EditableAvatar
              src={tournament.logo_url}
              name={tournament.name}
              size={80}
              shape="rounded"
              editable={!disabled}
              busy={busy}
              onSelectFile={(file) => upload.mutate({ slot: "logo", file })}
              onDelete={tournament.logo_url ? () => remove.mutate("logo") : undefined}
              maxSizeBytes={MAX_AVATAR_BYTES}
              onError={(message) => notify.error(message)}
              disabled={disabled}
            />
            <p className="text-xs text-muted-foreground">{t("logoHint")}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
