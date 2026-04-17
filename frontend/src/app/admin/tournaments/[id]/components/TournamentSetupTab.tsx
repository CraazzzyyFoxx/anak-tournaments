"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LayoutGrid, MessageSquare, Pencil, RefreshCw, Trash2, Trophy, Wifi, WifiOff } from "lucide-react";
import { AdminDetailTableShell, getAdminDetailTableStyles } from "@/components/admin/AdminDetailTable";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { EntityFormDialog } from "@/components/admin/EntityFormDialog";
import { StatusIcon } from "@/components/admin/StatusIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import adminService from "@/services/admin.service";
import type { DiscordChannelInput, DiscordChannelRead } from "@/types/admin.types";
import type { Stage, Tournament } from "@/types/tournament.types";
import { ChallongeSyncPanel } from "./ChallongeSyncPanel";
import { StageManager } from "./StageManager";
import { getTournamentWorkspaceQueryKeys } from "./tournamentWorkspace.queryKeys";

interface TournamentSetupTabProps {
  tournamentId: number;
  tournament: Tournament;
  stages: Stage[];
  hasChallongeSource: boolean;
  canUpdateTournament: boolean;
  discordChannel: DiscordChannelRead | null | undefined;
  discordChannelLoading: boolean;
}

export function TournamentSetupTab({
  tournamentId,
  tournament,
  stages,
  hasChallongeSource,
  canUpdateTournament,
  discordChannel,
  discordChannelLoading,
}: TournamentSetupTabProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const tableStyles = getAdminDetailTableStyles("compact");
  const queryKeys = getTournamentWorkspaceQueryKeys(tournamentId);

  const [discordChannelDialogOpen, setDiscordChannelDialogOpen] = useState(false);
  const [discordChannelDeleteOpen, setDiscordChannelDeleteOpen] = useState(false);
  const [discordChannelForm, setDiscordChannelForm] = useState<DiscordChannelInput>({
    guild_id: "",
    channel_id: "",
    channel_name: "",
    is_active: true,
  });

  const saveDiscordChannelMutation = useMutation({
    mutationFn: (data: DiscordChannelInput) => adminService.setDiscordChannel(tournamentId, data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.discordChannel });
      setDiscordChannelDialogOpen(false);
      toast({ title: "Discord channel configured" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteDiscordChannelMutation = useMutation({
    mutationFn: () => adminService.deleteDiscordChannel(tournamentId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.discordChannel });
      setDiscordChannelDeleteOpen(false);
      toast({ title: "Discord channel removed" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const openDiscordDialog = () => {
    setDiscordChannelForm({
      guild_id: discordChannel?.guild_id ?? "",
      channel_id: discordChannel?.channel_id ?? "",
      channel_name: discordChannel?.channel_name ?? "",
      is_active: discordChannel?.is_active ?? true,
    });
    saveDiscordChannelMutation.reset();
    setDiscordChannelDialogOpen(true);
  };

  return (
    <>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <Card className="border-border/40">
          <CardContent className="pt-4">
            <StageManager tournamentId={tournamentId} />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="border-border/40">
            <CardContent className="pt-4">
              <ChallongeSyncPanel
                tournamentId={tournamentId}
                challongeId={tournament.challonge_id}
              />
            </CardContent>
          </Card>

          <Card className="border-border/40">
            <CardHeader className="flex flex-row items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                <CardTitle className="text-sm font-semibold">Discord Sync</CardTitle>
              </div>
              {canUpdateTournament ? (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={openDiscordDialog}>
                    <Pencil className="size-3.5" />
                    {discordChannel ? "Edit" : "Configure"}
                  </Button>
                  {discordChannel ? (
                    <Button variant="destructive" size="sm" onClick={() => setDiscordChannelDeleteOpen(true)}>
                      <Trash2 className="size-3.5" />
                      Remove
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </CardHeader>
            <CardContent>
              {discordChannelLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : discordChannel ? (
                <div className="grid grid-cols-2 gap-3 text-[13px]">
                  <div>
                    <p className="text-[11px] text-muted-foreground/50">Guild</p>
                    <p className="font-mono text-[12px]">{discordChannel.guild_id}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground/50">Channel</p>
                    <p className="font-mono text-[12px]">{discordChannel.channel_id}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground/50">Name</p>
                    <p>{discordChannel.channel_name ?? "-"}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground/50">Status</p>
                    {discordChannel.is_active ? (
                      <StatusIcon icon={Wifi} label="Active" variant="success" />
                    ) : (
                      <StatusIcon icon={WifiOff} label="Inactive" variant="muted" />
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-[13px] text-muted-foreground">No Discord channel configured.</p>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/40">
            <CardHeader className="flex flex-row items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <CardTitle className="text-sm font-semibold">Stages</CardTitle>
                <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground/50">
                  <span>{stages.length} total</span>
                  <span>|</span>
                  <span>{stages.filter((stage) => Boolean(stage.challonge_slug)).length} linked</span>
                </div>
              </div>
              {!hasChallongeSource ? (
                <Badge variant="outline">No Challonge link</Badge>
              ) : (
                <Button variant="outline" size="sm" className="pointer-events-none opacity-80">
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Sync enabled
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <AdminDetailTableShell variant="compact">
                <Table>
                  <TableHeader>
                    <TableRow className={tableStyles.headerRow}>
                      <TableHead className={tableStyles.head}>Stage</TableHead>
                      <TableHead className={tableStyles.head}>Type</TableHead>
                      <TableHead className={tableStyles.head}>Challonge</TableHead>
                      <TableHead className={tableStyles.head}>Items</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stages.length ? (
                      stages.map((stage) => (
                        <TableRow key={stage.id} className={tableStyles.row}>
                          <TableCell className={`${tableStyles.cell} font-medium`}>
                            {stage.name}
                          </TableCell>
                          <TableCell className={tableStyles.cell}>
                            <StatusIcon
                              icon={
                                stage.stage_type === "round_robin" || stage.stage_type === "swiss"
                                  ? LayoutGrid
                                  : Trophy
                              }
                              label={stage.stage_type.replaceAll("_", " ")}
                              variant={
                                stage.stage_type === "round_robin" || stage.stage_type === "swiss"
                                  ? "info"
                                  : "warning"
                              }
                            />
                          </TableCell>
                          <TableCell className={tableStyles.cell}>
                            {stage.challonge_slug ? (
                              <a
                                className="text-sm font-medium text-primary hover:underline"
                                href={`https://challonge.com/${stage.challonge_slug}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {stage.challonge_slug}
                              </a>
                            ) : (
                              <span className="text-sm text-muted-foreground">Manual only</span>
                            )}
                          </TableCell>
                          <TableCell className={tableStyles.cell}>
                            <span className="text-sm text-muted-foreground">{stage.items.length}</span>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow className={tableStyles.row}>
                        <TableCell className={tableStyles.cell} colSpan={4}>
                          <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
                            <span>
                              No stages configured yet. Use the stage manager on the left to set up the tournament flow.
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </AdminDetailTableShell>
            </CardContent>
          </Card>
        </div>
      </div>

      <EntityFormDialog
        open={discordChannelDialogOpen}
        onOpenChange={(open) => {
          setDiscordChannelDialogOpen(open);
          if (!open) saveDiscordChannelMutation.reset();
        }}
        title="Configure Discord Sync Channel"
        description="Set the Discord guild and channel from which match logs are automatically imported."
        onSubmit={(event) => {
          event.preventDefault();
          saveDiscordChannelMutation.mutate(discordChannelForm);
        }}
        isSubmitting={saveDiscordChannelMutation.isPending}
        submittingLabel="Saving..."
        errorMessage={
          saveDiscordChannelMutation.isError ? saveDiscordChannelMutation.error.message : undefined
        }
        isDirty
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="discord-guild-id">Guild ID</Label>
            <Input
              id="discord-guild-id"
              type="text"
              inputMode="numeric"
              value={discordChannelForm.guild_id}
              onChange={(event) =>
                setDiscordChannelForm((current) => ({
                  ...current,
                  guild_id: event.target.value.replace(/\D/g, ""),
                }))
              }
              placeholder="e.g. 123456789012345678"
            />
          </div>
          <div>
            <Label htmlFor="discord-channel-id">Channel ID</Label>
            <Input
              id="discord-channel-id"
              type="text"
              inputMode="numeric"
              value={discordChannelForm.channel_id}
              onChange={(event) =>
                setDiscordChannelForm((current) => ({
                  ...current,
                  channel_id: event.target.value.replace(/\D/g, ""),
                }))
              }
              placeholder="e.g. 987654321098765432"
            />
          </div>
          <div>
            <Label htmlFor="discord-channel-name">Channel Name (optional)</Label>
            <Input
              id="discord-channel-name"
              value={discordChannelForm.channel_name ?? ""}
              onChange={(event) =>
                setDiscordChannelForm((current) => ({
                  ...current,
                  channel_name: event.target.value || null,
                }))
              }
              placeholder="e.g. #match-logs"
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="discord-is-active"
              checked={discordChannelForm.is_active}
              onCheckedChange={(checked) =>
                setDiscordChannelForm((current) => ({ ...current, is_active: Boolean(checked) }))
              }
            />
            <Label htmlFor="discord-is-active">Active (bot will monitor this channel)</Label>
          </div>
        </div>
      </EntityFormDialog>

      <DeleteConfirmDialog
        open={discordChannelDeleteOpen}
        onOpenChange={setDiscordChannelDeleteOpen}
        onConfirm={() => deleteDiscordChannelMutation.mutate()}
        title="Remove Discord Channel"
        description="Remove the Discord sync channel configuration for this tournament? The bot will stop monitoring this channel."
        isDeleting={deleteDiscordChannelMutation.isPending}
      />
    </>
  );
}
