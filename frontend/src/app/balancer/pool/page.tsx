"use client";

import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { Download, Loader2, Upload } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApplicationCombobox } from "@/app/balancer/_components/ApplicationCombobox";
import { PoolPlayerCard } from "@/app/balancer/_components/PoolPlayerCard";
import { useBalancerTournamentId } from "@/app/balancer/_components/useBalancerTournamentId";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import balancerAdminService from "@/services/balancer-admin.service";
import {
  BalancerPlayerImportPreviewResponse,
  DuplicateResolution,
  DuplicateStrategy,
} from "@/types/balancer-admin.types";

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function buildInitialDuplicateResolutions(
  preview: BalancerPlayerImportPreviewResponse,
): Record<string, DuplicateResolution> {
  return preview.duplicates.reduce<Record<string, DuplicateResolution>>((accumulator, duplicate) => {
    accumulator[duplicate.battle_tag_normalized] = "replace";
    return accumulator;
  }, {});
}

export default function BalancerPoolPage() {
  const tournamentId = useBalancerTournamentId();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [selectedImportFile, setSelectedImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<BalancerPlayerImportPreviewResponse | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [duplicateResolutions, setDuplicateResolutions] = useState<Record<string, DuplicateResolution>>({});
  const [applyToAllResolution, setApplyToAllResolution] = useState<DuplicateResolution | null>(null);

  const applicationsQuery = useQuery({
    queryKey: ["balancer-public", "applications", tournamentId],
    queryFn: () => balancerAdminService.listApplications(tournamentId as number, true),
    enabled: tournamentId !== null,
  });

  const playersQuery = useQuery({
    queryKey: ["balancer-public", "players", tournamentId],
    queryFn: () => balancerAdminService.listPlayers(tournamentId as number),
    enabled: tournamentId !== null,
  });

  const addPlayerMutation = useMutation({
    mutationFn: async (applicationId: number) => {
      if (!tournamentId) {
        throw new Error("Select a tournament first");
      }
      return balancerAdminService.createPlayersFromApplications(tournamentId, { application_ids: [applicationId] });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["balancer-public", "applications", tournamentId] }),
        queryClient.invalidateQueries({ queryKey: ["balancer-public", "players", tournamentId] }),
      ]);
      toast({ title: "Player added to pool" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add player", description: error.message, variant: "destructive" });
    },
  });

  const updatePlayerMutation = useMutation({
    mutationFn: ({ playerId, payload }: { playerId: number; payload: Parameters<typeof balancerAdminService.updatePlayer>[1] }) =>
      balancerAdminService.updatePlayer(playerId, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["balancer-public", "players", tournamentId] }),
        queryClient.invalidateQueries({ queryKey: ["balancer-public", "applications", tournamentId] }),
      ]);
      toast({ title: "Player updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update player", description: error.message, variant: "destructive" });
    },
  });

  const removePlayerMutation = useMutation({
    mutationFn: (playerId: number) => balancerAdminService.deletePlayer(playerId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["balancer-public", "players", tournamentId] }),
        queryClient.invalidateQueries({ queryKey: ["balancer-public", "applications", tournamentId] }),
      ]);
      toast({ title: "Player removed from pool" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to remove player", description: error.message, variant: "destructive" });
    },
  });

  const importPlayersMutation = useMutation({
    mutationFn: async ({
      file,
      duplicateStrategy,
      resolutions,
    }: {
      file: File;
      duplicateStrategy: DuplicateStrategy;
      resolutions?: Record<string, DuplicateResolution>;
    }) => {
      if (!tournamentId) {
        throw new Error("Select a tournament first");
      }

      return balancerAdminService.importPlayers(tournamentId, file, duplicateStrategy, resolutions);
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["balancer-public", "players", tournamentId] }),
        queryClient.invalidateQueries({ queryKey: ["balancer-public", "applications", tournamentId] }),
      ]);

      setImportDialogOpen(false);
      setImportPreview(null);
      setSelectedImportFile(null);
      setDuplicateResolutions({});
      setApplyToAllResolution(null);

      toast({
        title: "Players imported",
        description: [
          `${result.created} created`,
          `${result.replaced} replaced`,
          `${result.skipped_duplicates} skipped duplicates`,
          `${result.skipped_missing_application} skipped without active application`,
        ].join(" · "),
      });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to import players", description: error.message, variant: "destructive" });
    },
  });

  const previewImportMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!tournamentId) {
        throw new Error("Select a tournament first");
      }
      return balancerAdminService.previewPlayerImport(tournamentId, file);
    },
    onSuccess: (preview, file) => {
      setSelectedImportFile(file);
      setImportPreview(preview);
      setDuplicateResolutions(buildInitialDuplicateResolutions(preview));
      setApplyToAllResolution(preview.duplicate_players > 0 ? "replace" : null);

      if (preview.duplicate_players === 0) {
        importPlayersMutation.mutate({ file, duplicateStrategy: "skip_all" });
        return;
      }

      setImportDialogOpen(true);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to preview import", description: error.message, variant: "destructive" });
    },
  });

  const exportPlayersMutation = useMutation({
    mutationFn: async () => {
      if (!tournamentId) {
        throw new Error("Select a tournament first");
      }
      return balancerAdminService.exportPlayers(tournamentId);
    },
    onSuccess: (payload) => {
      downloadJson(`balancer-players-${tournamentId}.json`, payload);
      toast({ title: "Players exported" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to export players", description: error.message, variant: "destructive" });
    },
  });

  const applications = applicationsQuery.data ?? [];
  const players = playersQuery.data ?? [];
  const unresolvedDuplicates = useMemo(
    () =>
      (importPreview?.duplicates ?? []).filter(
        (duplicate) => !duplicateResolutions[duplicate.battle_tag_normalized],
      ),
    [duplicateResolutions, importPreview],
  );

  const canConfirmImport =
    selectedImportFile !== null &&
    !importPlayersMutation.isPending &&
    (((importPreview?.duplicate_players ?? 0) === 0) || unresolvedDuplicates.length === 0);

  if (!tournamentId) {
    return (
      <Alert>
        <AlertTitle>Select a tournament</AlertTitle>
        <AlertDescription>Choose a tournament in the balancer header before editing the player pool.</AlertDescription>
      </Alert>
    );
  }

  const handleImportFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    previewImportMutation.mutate(file);
    event.target.value = "";
  };

  const handleDuplicateActionChange = (battleTagNormalized: string, resolution: DuplicateResolution) => {
    setApplyToAllResolution(null);
    setDuplicateResolutions((current) => ({
      ...current,
      [battleTagNormalized]: resolution,
    }));
  };

  const handleApplyToAllChange = (resolution: DuplicateResolution, checked: boolean) => {
    if (!importPreview) {
      return;
    }

    if (!checked) {
      if (applyToAllResolution === resolution) {
        setApplyToAllResolution(null);
      }
      return;
    }

    setApplyToAllResolution(resolution);
    setDuplicateResolutions(
      importPreview.duplicates.reduce<Record<string, DuplicateResolution>>((accumulator, duplicate) => {
        accumulator[duplicate.battle_tag_normalized] = resolution;
        return accumulator;
      }, {}),
    );
  };

  const handleConfirmImport = () => {
    if (!selectedImportFile || !importPreview) {
      return;
    }

    let duplicateStrategy: DuplicateStrategy = "manual";
    let resolutions: Record<string, DuplicateResolution> | undefined = duplicateResolutions;

    if (importPreview.duplicate_players === 0) {
      duplicateStrategy = "skip_all";
      resolutions = undefined;
    } else if (applyToAllResolution === "replace") {
      duplicateStrategy = "replace_all";
      resolutions = undefined;
    } else if (applyToAllResolution === "skip") {
      duplicateStrategy = "skip_all";
      resolutions = undefined;
    }

    importPlayersMutation.mutate({
      file: selectedImportFile,
      duplicateStrategy,
      resolutions,
    });
  };

  return (
    <>
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Add player</CardTitle>
                <CardDescription>
                  Search synced applications, add registrations to the pool, or bulk import/export players in the atravkovs-compatible balancer format.
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={handleImportFileChange}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={previewImportMutation.isPending || importPlayersMutation.isPending}
                >
                  {previewImportMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-2 h-4 w-4" />
                  )}
                  Import players
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => exportPlayersMutation.mutate()}
                  disabled={exportPlayersMutation.isPending}
                >
                  {exportPlayersMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  Export players
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <ApplicationCombobox
              applications={applications}
              onAdd={(application) => addPlayerMutation.mutate(application.id)}
              disabled={addPlayerMutation.isPending}
            />
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">Pool players: {players.length}</Badge>
              <Badge variant="outline">
                Available applications: {applications.filter((application) => application.player === null && application.is_active).length}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-2">
          {players.map((player) => (
            <PoolPlayerCard
              key={player.id}
              player={player}
              saving={updatePlayerMutation.isPending}
              onSave={(playerId, payload) => updatePlayerMutation.mutate({ playerId, payload })}
              onRemove={(playerId) => removePlayerMutation.mutate(playerId)}
            />
          ))}
        </div>
      </div>

      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Resolve duplicate players</DialogTitle>
            <DialogDescription>
              Players without an active application are always skipped. Choose how duplicate pool records should be handled before import.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">Create: {importPreview?.creatable_players ?? 0}</Badge>
              <Badge variant="outline">Duplicates: {importPreview?.duplicate_players ?? 0}</Badge>
              <Badge variant="outline">Skipped: {importPreview?.skipped_players ?? 0}</Badge>
            </div>

            <div className="flex flex-wrap gap-6 rounded-lg border p-4">
              <div className="flex items-center gap-2 text-sm">
                <Checkbox
                  id="replace-all-duplicates"
                  checked={applyToAllResolution === "replace"}
                  onCheckedChange={(checked) => handleApplyToAllChange("replace", checked === true)}
                />
                <Label htmlFor="replace-all-duplicates" className="cursor-pointer font-normal">
                  Replace all duplicates
                </Label>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Checkbox
                  id="skip-all-duplicates"
                  checked={applyToAllResolution === "skip"}
                  onCheckedChange={(checked) => handleApplyToAllChange("skip", checked === true)}
                />
                <Label htmlFor="skip-all-duplicates" className="cursor-pointer font-normal">
                  Skip all duplicates
                </Label>
              </div>
            </div>

            <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
              {(importPreview?.duplicates ?? []).map((duplicate) => {
                const selectedResolution = duplicateResolutions[duplicate.battle_tag_normalized] ?? null;

                return (
                  <div key={duplicate.battle_tag_normalized} className="rounded-lg border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{duplicate.battle_tag}</p>
                        <p className="text-xs text-muted-foreground">
                          Existing player #{duplicate.existing_player_id} · application #{duplicate.application_id}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant={selectedResolution === "replace" ? "default" : "outline"}
                          onClick={() => handleDuplicateActionChange(duplicate.battle_tag_normalized, "replace")}
                        >
                          Replace
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={selectedResolution === "skip" ? "secondary" : "outline"}
                          onClick={() => handleDuplicateActionChange(duplicate.battle_tag_normalized, "skip")}
                        >
                          Skip
                        </Button>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-3 text-xs md:grid-cols-2">
                      <div className="rounded-md bg-muted/50 p-3">
                        <p className="mb-1 font-medium">Imported</p>
                        <p>Roles: {duplicate.imported_role_entries_json.length}</p>
                        <p>In pool: {duplicate.imported_is_in_pool ? "Yes" : "No"}</p>
                        <p>Notes: {duplicate.imported_admin_notes ?? "-"}</p>
                      </div>
                      <div className="rounded-md bg-muted/50 p-3">
                        <p className="mb-1 font-medium">Existing</p>
                        <p>Roles: {duplicate.existing_role_entries_json.length}</p>
                        <p>In pool: {duplicate.existing_is_in_pool ? "Yes" : "No"}</p>
                        <p>Notes: {duplicate.existing_admin_notes ?? "-"}</p>
                      </div>
                    </div>
                  </div>
                );
              })}

              {(importPreview?.skipped ?? []).length ? (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">Always skipped</p>
                  <div className="mt-2 space-y-1 text-xs">
                    {importPreview?.skipped.map((entry) => (
                      <p key={`${entry.reason}-${entry.battle_tag_normalized}`}>
                        {entry.battle_tag}: {entry.reason === "missing_active_application" ? "no active application for this tournament" : "duplicate row inside import file"}
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmImport} disabled={!canConfirmImport}>
              {importPlayersMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirm import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
