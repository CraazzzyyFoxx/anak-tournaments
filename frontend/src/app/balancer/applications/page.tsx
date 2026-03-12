"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCcw, Save } from "lucide-react";

import { useBalancerTournamentId } from "@/app/balancer/_components/useBalancerTournamentId";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import balancerAdminService from "@/services/balancer-admin.service";

export default function BalancerApplicationsPage() {
  const tournamentId = useBalancerTournamentId();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [sheetUrl, setSheetUrl] = useState("");

  const sheetQuery = useQuery({
    queryKey: ["balancer-public", "sheet", tournamentId],
    queryFn: () => balancerAdminService.getTournamentSheet(tournamentId as number),
    enabled: tournamentId !== null,
  });

  const applicationsQuery = useQuery({
    queryKey: ["balancer-public", "applications", tournamentId],
    queryFn: () => balancerAdminService.listApplications(tournamentId as number, true),
    enabled: tournamentId !== null,
  });

  useEffect(() => {
    setSheetUrl(sheetQuery.data?.source_url ?? "");
  }, [sheetQuery.data?.source_url]);

  const saveSourceMutation = useMutation({
    mutationFn: async () => {
      if (!tournamentId) {
        throw new Error("Select a tournament first");
      }
      return balancerAdminService.upsertTournamentSheet(tournamentId, { source_url: sheetUrl });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["balancer-public", "sheet", tournamentId] });
      toast({ title: "Sheet source saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save source", description: error.message, variant: "destructive" });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      if (!tournamentId) {
        throw new Error("Select a tournament first");
      }
      return balancerAdminService.syncTournamentSheet(tournamentId);
    },
    onSuccess: async (response) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["balancer-public", "sheet", tournamentId] }),
        queryClient.invalidateQueries({ queryKey: ["balancer-public", "applications", tournamentId] }),
        queryClient.invalidateQueries({ queryKey: ["balancer-public", "players", tournamentId] }),
      ]);
      toast({
        title: "Applications synced",
        description: `${response.created} created, ${response.updated} updated, ${response.deactivated} archived.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to sync sheet", description: error.message, variant: "destructive" });
    },
  });

  if (!tournamentId) {
    return (
      <Alert>
        <AlertTitle>Select a tournament</AlertTitle>
        <AlertDescription>Choose a tournament in the balancer header before syncing applications.</AlertDescription>
      </Alert>
    );
  }

  const applications = applicationsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Google Sheets Source</CardTitle>
          <CardDescription>Attach or update the public sheet URL, then sync fresh applications into the tournament.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[1fr_auto_auto] lg:items-end">
          <div className="space-y-2">
            <Label>Google Sheets URL</Label>
            <Input value={sheetUrl} onChange={(event) => setSheetUrl(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." />
          </div>
          <Button onClick={() => saveSourceMutation.mutate()} disabled={!sheetUrl || saveSourceMutation.isPending}>
            {saveSourceMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save source
          </Button>
          <Button variant="secondary" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
            {syncMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
            Sync now
          </Button>

          <div className="lg:col-span-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
            {sheetQuery.data?.sheet_id ? <Badge variant="outline">Sheet ID: {sheetQuery.data.sheet_id}</Badge> : null}
            {sheetQuery.data?.gid ? <Badge variant="outline">gid: {sheetQuery.data.gid}</Badge> : null}
            <Badge variant="outline">Status: {sheetQuery.data?.last_sync_status ?? "pending"}</Badge>
            {sheetQuery.data?.last_synced_at ? <Badge variant="outline">Last sync: {new Date(sheetQuery.data.last_synced_at).toLocaleString()}</Badge> : null}
          </div>
          {sheetQuery.data?.last_error ? (
            <Alert className="lg:col-span-3" variant="destructive">
              <AlertTitle>Last sync error</AlertTitle>
              <AlertDescription>{sheetQuery.data.last_error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Applications</CardTitle>
          <CardDescription>Review the full imported list, including archived applications and pool status.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>BattleTag</TableHead>
                <TableHead>Primary</TableHead>
                <TableHead>Additional</TableHead>
                <TableHead>Discord</TableHead>
                <TableHead>Twitch</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {applications.map((application) => (
                <TableRow key={application.id} className={!application.is_active ? "opacity-60" : undefined}>
                  <TableCell className="font-medium">{application.battle_tag}</TableCell>
                  <TableCell>{application.primary_role ?? "—"}</TableCell>
                  <TableCell>{application.additional_roles_json.join(", ") || "—"}</TableCell>
                  <TableCell>{application.discord_nick ?? "—"}</TableCell>
                  <TableCell>{application.twitch_nick ?? "—"}</TableCell>
                  <TableCell>
                    {application.player ? <Badge>In pool</Badge> : application.is_active ? <Badge variant="outline">Ready</Badge> : <Badge variant="secondary">Archived</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
