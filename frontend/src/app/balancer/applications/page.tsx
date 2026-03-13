"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCcw, Save } from "lucide-react";

import { useBalancerTournamentId } from "@/app/balancer/_components/useBalancerTournamentId";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import balancerAdminService from "@/services/balancer-admin.service";
import { BalancerApplication } from "@/types/balancer-admin.types";

type ApplicationStatusFilter = "all" | "in-pool" | "ready" | "archived";

function getApplicationStatus(application: BalancerApplication): ApplicationStatusFilter {
  if (application.player) {
    return "in-pool";
  }

  return application.is_active ? "ready" : "archived";
}

export default function BalancerApplicationsPage() {
  const tournamentId = useBalancerTournamentId();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [sheetUrl, setSheetUrl] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ApplicationStatusFilter>("all");
  const [roleFilter, setRoleFilter] = useState("all");

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

  const applications = applicationsQuery.data ?? [];
  const roleOptions = useMemo(() => {
    const uniqueRoles = new Set<string>();

    applications.forEach((application) => {
      if (application.primary_role) {
        uniqueRoles.add(application.primary_role);
      }

      application.additional_roles_json.forEach((role) => {
        if (role) {
          uniqueRoles.add(role);
        }
      });
    });

    return Array.from(uniqueRoles).sort((left, right) => left.localeCompare(right));
  }, [applications]);

  const filteredApplications = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return applications.filter((application) => {
      const status = getApplicationStatus(application);
      const matchesStatus = statusFilter === "all" || status === statusFilter;

      const applicationRoles = [application.primary_role, ...application.additional_roles_json].filter(Boolean);
      const matchesRole = roleFilter === "all" || applicationRoles.includes(roleFilter);

      const haystack = [
        application.battle_tag,
        application.discord_nick ?? "",
        application.twitch_nick ?? "",
        application.last_tournament_text ?? "",
        ...applicationRoles,
      ]
        .join(" ")
        .toLowerCase();
      const matchesQuery = !normalizedQuery || haystack.includes(normalizedQuery);

      return matchesStatus && matchesRole && matchesQuery;
    });
  }, [applications, roleFilter, searchQuery, statusFilter]);

  if (!tournamentId) {
    return (
      <Alert>
        <AlertTitle>Select a tournament</AlertTitle>
        <AlertDescription>Choose a tournament in the balancer header before syncing applications.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden">
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

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader>
          <CardTitle>Applications</CardTitle>
          <CardDescription>
            Review the full imported list, including archived applications and pool status. Showing {filteredApplications.length} of {applications.length} applications.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px]">
            <div className="space-y-2">
              <Label htmlFor="application-search">Search</Label>
              <Input
                id="application-search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search by BattleTag, Discord, Twitch, or role"
              />
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as ApplicationStatusFilter)}>
                <SelectTrigger>
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="in-pool">In pool</SelectItem>
                  <SelectItem value="ready">Ready</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All roles" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  {roleOptions.map((role) => (
                    <SelectItem key={role} value={role}>
                      {role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border/60">
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
                {filteredApplications.length > 0 ? (
                  filteredApplications.map((application) => (
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
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      No applications match the current filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
