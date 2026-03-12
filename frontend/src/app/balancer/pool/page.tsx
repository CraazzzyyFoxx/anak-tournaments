"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApplicationCombobox } from "@/app/balancer/_components/ApplicationCombobox";
import { PoolPlayerCard } from "@/app/balancer/_components/PoolPlayerCard";
import { useBalancerTournamentId } from "@/app/balancer/_components/useBalancerTournamentId";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import balancerAdminService from "@/services/balancer-admin.service";

export default function BalancerPoolPage() {
  const tournamentId = useBalancerTournamentId();
  const queryClient = useQueryClient();
  const { toast } = useToast();

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

  if (!tournamentId) {
    return (
      <Alert>
        <AlertTitle>Select a tournament</AlertTitle>
        <AlertDescription>Choose a tournament in the balancer header before editing the player pool.</AlertDescription>
      </Alert>
    );
  }

  const applications = applicationsQuery.data ?? [];
  const players = playersQuery.data ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add player</CardTitle>
          <CardDescription>Search the synced applications in compact form, then add the selected registration into the editable balancing pool.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ApplicationCombobox applications={applications} onAdd={(application) => addPlayerMutation.mutate(application.id)} disabled={addPlayerMutation.isPending} />
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">Pool players: {players.length}</Badge>
            <Badge variant="outline">Available applications: {applications.filter((application) => application.player === null && application.is_active).length}</Badge>
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
  );
}
