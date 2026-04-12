"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import adminService from "@/services/admin.service";
import type { ChallongeSyncLogEntry } from "@/types/admin.types";

interface ChallongeSyncPanelProps {
  tournamentId: number;
  challongeId: number | null;
}

export function ChallongeSyncPanel({
  tournamentId,
  challongeId,
}: ChallongeSyncPanelProps) {
  const queryClient = useQueryClient();

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["admin", "challonge-sync-log", tournamentId],
    queryFn: () => adminService.challongeSyncLog(tournamentId, 20),
    enabled: !!challongeId,
  });

  const importMutation = useMutation({
    mutationFn: () => adminService.challongeImport(tournamentId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["admin", "challonge-sync-log", tournamentId],
      });
      queryClient.invalidateQueries({
        queryKey: ["admin", "tournament", tournamentId],
      });
    },
  });

  const exportMutation = useMutation({
    mutationFn: () => adminService.challongeExport(tournamentId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["admin", "challonge-sync-log", tournamentId],
      });
    },
  });

  if (!challongeId) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-muted-foreground">
          No Challonge tournament linked. Set challonge_id to enable sync.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Challonge Sync</h3>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Actions</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Button
            disabled={importMutation.isPending}
            onClick={() => importMutation.mutate()}
          >
            {importMutation.isPending ? "Importing..." : "Import from Challonge"}
          </Button>
          <Button
            variant="outline"
            disabled={exportMutation.isPending}
            onClick={() => exportMutation.mutate()}
          >
            {exportMutation.isPending ? "Exporting..." : "Export to Challonge"}
          </Button>
        </CardContent>

        {importMutation.isSuccess && (
          <CardContent className="pt-0">
            <div className="text-sm text-green-500">
              Import: {JSON.stringify(importMutation.data)}
            </div>
          </CardContent>
        )}
        {exportMutation.isSuccess && (
          <CardContent className="pt-0">
            <div className="text-sm text-green-500">
              Export: {JSON.stringify(exportMutation.data)}
            </div>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Sync Log</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : logs.length === 0 ? (
            <div className="text-sm text-muted-foreground">No sync history</div>
          ) : (
            <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
              {logs.map((log: ChallongeSyncLogEntry) => (
                <div
                  key={log.id}
                  className="flex items-center gap-2 text-sm border-b border-border/50 pb-1.5"
                >
                  <Badge
                    variant={log.direction === "import" ? "default" : "secondary"}
                    className="text-xs w-14 justify-center"
                  >
                    {log.direction}
                  </Badge>
                  <Badge
                    variant={log.status === "success" ? "default" : "destructive"}
                    className="text-xs w-16 justify-center"
                  >
                    {log.status}
                  </Badge>
                  <span className="text-muted-foreground">
                    {log.entity_type}
                    {log.entity_id && ` #${log.entity_id}`}
                  </span>
                  {log.error_message && (
                    <span className="text-red-400 text-xs truncate max-w-[200px]">
                      {log.error_message}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(log.created_at).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
