"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plug, Trash2 } from "lucide-react";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { EntityFormDialog } from "@/components/admin/EntityFormDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { EYEBROW_CLASS, TONE_CLASS, type Tone } from "@/components/admin/tone";
import { cn } from "@/lib/utils";
import { notify } from "@/lib/notify";
import adminService from "@/services/admin.service";
import type { DiscordChannelInput, DiscordChannelRead } from "@/types/admin.types";
import type { Tournament } from "@/types/tournament.types";
import { ChallongeIntegrationSection } from "./ChallongeIntegrationSection";
import { getTournamentWorkspaceQueryKeys } from "./tournamentWorkspace.queryKeys";

interface TournamentIntegrationsPanelProps {
  tournamentId: number;
  tournament: Tournament;
  hasChallongeSource: boolean;
  canUpdateTournament: boolean;
  discordChannel: DiscordChannelRead | null | undefined;
  discordChannelLoading: boolean;
  challongeSlug: string;
  onChallongeSlugChange: (value: string) => void;
}

function DetailField({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="min-w-0">
      <p className={EYEBROW_CLASS}>{label}</p>
      <p className="mt-1 truncate font-mono text-xs">{value}</p>
    </div>
  );
}

/**
 * Every external-provider connection of the tournament, in one card.
 *
 * The Challonge sync panel used to sit on Overview while its sync triggers sat
 * on the Teams and Matches tabs, and Discord state was rendered five times on
 * Overview alone (tile, header icon, header badge, a "Status" detail field and
 * a health row). Overview now shows read-only integration state; configuration
 * lives here.
 *
 * Challonge and Discord are sections of one card rather than two stacked cards:
 * split across cards, each held a title, a description and a badge to say the
 * same "one provider, connected or not", and the Challonge link field sat in a
 * third card entirely.
 *
 * Rendered inside the settings form so it shares its grid, so every button here
 * carries `type="button"` — an unlabelled button submits the form it sits in.
 */
export function TournamentIntegrationsPanel({
  tournamentId,
  tournament,
  hasChallongeSource,
  canUpdateTournament,
  discordChannel,
  discordChannelLoading,
  challongeSlug,
  onChallongeSlugChange
}: TournamentIntegrationsPanelProps) {
  const queryClient = useQueryClient();
  const queryKeys = getTournamentWorkspaceQueryKeys(tournamentId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [form, setForm] = useState<DiscordChannelInput>({
    guild_id: "",
    channel_id: "",
    channel_name: "",
    is_active: true
  });

  const saveMutation = useMutation({
    mutationFn: (data: DiscordChannelInput) => adminService.setDiscordChannel(tournamentId, data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.discordChannel });
      setDialogOpen(false);
      notify.success("Discord channel saved");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: () => adminService.deleteDiscordChannel(tournamentId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.discordChannel });
      setDeleteOpen(false);
      notify.success("Discord channel removed");
    }
  });

  const openDialog = () => {
    setForm({
      guild_id: discordChannel?.guild_id ?? "",
      channel_id: discordChannel?.channel_id ?? "",
      channel_name: discordChannel?.channel_name ?? "",
      is_active: discordChannel?.is_active ?? true
    });
    saveMutation.reset();
    setDialogOpen(true);
  };

  const discordTone: Tone = discordChannel?.is_active
    ? "success"
    : discordChannel
      ? "neutral"
      : "warning";
  const discordLabel = discordChannel?.is_active
    ? "Monitoring"
    : discordChannel
      ? "Paused"
      : "Not configured";

  return (
    <>
      <Card className="border-border/40 bg-card/50">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Plug className="size-4 text-primary" aria-hidden />
            <CardTitle asChild className="text-sm font-semibold">
              <h2>Integrations</h2>
            </CardTitle>
          </div>
          <CardDescription className="text-xs">
            External services this tournament reads from and writes to.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <ChallongeIntegrationSection
            tournamentId={tournamentId}
            hasChallongeSource={hasChallongeSource}
            slug={challongeSlug}
            onSlugChange={onChallongeSlugChange}
          />

          <section className="flex flex-col gap-3 border-t border-border/30 pt-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className={EYEBROW_CLASS}>Discord match logs</h3>
              <Badge variant="outline" className={cn("shrink-0", TONE_CLASS[discordTone])}>
                {discordLabel}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Route Discord match logs into this tournament workspace.
            </p>

            {discordChannelLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : discordChannel ? (
              <div className="grid gap-3 rounded-lg border border-border/60 bg-muted/10 p-3 sm:grid-cols-3">
                <DetailField label="Guild" value={discordChannel.guild_id} />
                <DetailField label="Channel" value={discordChannel.channel_id} />
                <DetailField label="Name" value={discordChannel.channel_name ?? "—"} />
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border/70 bg-muted/10 p-3 text-xs text-muted-foreground">
                No channel yet. Add a guild and channel to start pulling match logs in
                automatically.
              </p>
            )}

            {canUpdateTournament ? (
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={openDialog}>
                  <Pencil className="mr-2 size-4" aria-hidden />
                  {discordChannel ? "Edit channel" : "Add channel"}
                </Button>
                {discordChannel ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="mr-2 size-4" aria-hidden />
                    Remove channel
                  </Button>
                ) : null}
              </div>
            ) : null}
          </section>
        </CardContent>
      </Card>

      <EntityFormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) saveMutation.reset();
        }}
        title="Discord match logs"
        description={`Set the Discord guild and channel for ${tournament.name}.`}
        onSubmit={(event) => {
          event.preventDefault();
          saveMutation.mutate(form);
        }}
        isSubmitting={saveMutation.isPending}
        submittingLabel="Saving…"
        errorMessage={saveMutation.isError ? saveMutation.error.message : undefined}
        isDirty
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="discord-guild-id">Guild ID</Label>
            <Input
              id="discord-guild-id"
              type="text"
              inputMode="numeric"
              value={form.guild_id}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  guild_id: event.target.value.replace(/\D/g, "")
                }))
              }
              placeholder="123456789012345678"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="discord-channel-id">Channel ID</Label>
            <Input
              id="discord-channel-id"
              type="text"
              inputMode="numeric"
              value={form.channel_id}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  channel_id: event.target.value.replace(/\D/g, "")
                }))
              }
              placeholder="987654321098765432"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="discord-channel-name">Channel name (optional)</Label>
            <Input
              id="discord-channel-name"
              value={form.channel_name ?? ""}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  channel_name: event.target.value || null
                }))
              }
              placeholder="#match-logs"
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="discord-is-active"
              checked={form.is_active}
              onCheckedChange={(checked) =>
                setForm((current) => ({ ...current, is_active: Boolean(checked) }))
              }
            />
            <Label htmlFor="discord-is-active">Monitor this channel</Label>
          </div>
        </div>
      </EntityFormDialog>

      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={() => deleteMutation.mutate()}
        title="Remove Discord channel"
        description="The bot stops monitoring this channel and match logs will no longer arrive automatically. The tournament and its existing logs are untouched."
        isDeleting={deleteMutation.isPending}
      />
    </>
  );
}
