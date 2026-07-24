"use client";

import { useQueries } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Network } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import workspaceService from "@/services/workspace.service";
import type { DivisionGridVersion } from "@/types/workspace.types";

interface Props {
  workspaceId: number;
  versions: DivisionGridVersion[];
  onSelectVersion: (versionId: number, sourceVersionId: number | null) => void;
}

export function MappingReadinessMatrix({ workspaceId, versions, onSelectVersion }: Props) {
  const publishedVersions = versions.filter((version) => version.status === "published");
  const readinessQueries = useQueries({
    queries: publishedVersions.map((version) => ({
      queryKey: ["division-grid-readiness", workspaceId, version.id],
      queryFn: () => workspaceService.getDivisionGridVersionReadiness(workspaceId, version.id),
      staleTime: 15_000
    }))
  });

  if (publishedVersions.length === 0) return null;

  return (
    <Card id="mappings">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Network className="h-4 w-4" /> Activation readiness
        </CardTitle>
        <CardDescription>
          Every historical source version used by tournaments needs a complete mapping into the next
          active version.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {publishedVersions.map((version, index) => {
          const query = readinessQueries[index];
          const readiness = query.data;
          const blocked = readiness
            ? Array.from(
                new Set([
                  ...readiness.missing_mapping_version_ids,
                  ...readiness.incomplete_mapping_version_ids
                ])
              )
            : [];
          return (
            <div
              key={version.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div className="flex items-center gap-3">
                {readiness?.is_ready ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-amber-500" />
                )}
                <div>
                  <div className="font-medium">
                    v{version.version} · {version.label}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {query.isLoading
                      ? "Checking mappings…"
                      : query.isError
                        ? "Readiness could not be loaded"
                        : readiness?.is_ready
                          ? `${readiness.used_source_version_ids.length} source version(s) covered`
                          : `Blocked by source version ID(s): ${blocked.join(", ") || "unknown"}`}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={readiness?.is_ready ? "default" : "secondary"}>
                  {readiness?.is_ready ? "Ready" : "Needs mappings"}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    onSelectVersion(
                      version.id,
                      readiness?.missing_mapping_version_ids[0] ??
                        readiness?.incomplete_mapping_version_ids[0] ??
                        readiness?.used_source_version_ids.find((id) => id !== version.id) ??
                        null
                    )
                  }
                >
                  Review
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
