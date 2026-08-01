"use client";

import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { usePermissions } from "@/hooks/usePermissions";
import { TONE_CLASS, type Tone } from "@/components/admin/tone";
import adminService from "@/services/admin.service";
import type { Tournament, TournamentStatus } from "@/types/tournament.types";
import { invalidateTournamentWorkspace } from "./tournamentWorkspace.queryKeys";

/**
 * `tone` replaces the previous raw-palette fills. `bg-yellow-500 text-white`
 * measured APCA |Lc| 40.7 (WCAG 1.92:1) and `bg-green-500 text-white` 49.2
 * (2.28:1) — both far below the 60 floor for non-body text, on the workspace's
 * primary status indicator.
 */
const STATUS_CONFIG: Record<
  TournamentStatus,
  { label: string; tone: Tone; next: TournamentStatus[] }
> = {
  registration: {
    label: "Registration",
    tone: "info",
    next: ["draft"]
  },
  draft: {
    label: "Draft",
    tone: "warning",
    next: ["check_in", "live"]
  },
  check_in: {
    label: "Check-in",
    tone: "warning",
    next: ["live"]
  },
  live: {
    label: "Live",
    tone: "success",
    next: ["playoffs", "completed"]
  },
  playoffs: {
    label: "Playoffs",
    tone: "accent",
    next: ["completed"]
  },
  completed: {
    label: "Completed",
    tone: "neutral",
    next: ["archived"]
  },
  archived: {
    label: "Archived",
    tone: "neutral",
    next: ["completed"]
  }
};

interface TournamentStatusControlProps {
  tournament: Tournament;
}

export function TournamentStatusControl({ tournament }: TournamentStatusControlProps) {
  const queryClient = useQueryClient();
  const { isSuperuser } = usePermissions();
  const config = STATUS_CONFIG[tournament.status];
  const [overrideStatus, setOverrideStatus] = useState<TournamentStatus | null>(null);
  const overrideId = useId();

  const mutation = useMutation({
    mutationFn: ({ status, force = false }: { status: TournamentStatus; force?: boolean }) =>
      adminService.transitionTournamentStatus(tournament.id, { status, force }),
    onSuccess: () => {
      setOverrideStatus(null);
      invalidateTournamentWorkspace(queryClient, tournament.id);
    }
  });

  const overrideBlocked = !overrideStatus || overrideStatus === tournament.status;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Badge variant="outline" className={TONE_CLASS[config.tone]}>
        {config.label}
      </Badge>

      {config.next.length > 0 && (
        <div className="flex gap-2">
          {config.next.map((nextStatus) => (
            <Button
              key={nextStatus}
              size="sm"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate({ status: nextStatus })}
            >
              {mutation.isPending ? (
                <Loader2 className="mr-1.5 size-3 animate-spin" aria-hidden />
              ) : null}
              {`\u2192 ${STATUS_CONFIG[nextStatus].label}`}
            </Button>
          ))}
        </div>
      )}

      {isSuperuser ? (
        <div className="flex items-center gap-2">
          <Label htmlFor={overrideId} className="sr-only">
            Override tournament status
          </Label>
          <Select
            value={overrideStatus ?? tournament.status}
            onValueChange={(value) => setOverrideStatus(value as TournamentStatus)}
          >
            <SelectTrigger id={overrideId} className="h-8 w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(STATUS_CONFIG).map(([value, statusConfig]) => (
                <SelectItem key={value} value={value}>
                  {statusConfig.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="secondary"
            disabled={mutation.isPending || overrideBlocked}
            onClick={() => {
              if (!overrideStatus || overrideStatus === tournament.status) return;
              mutation.mutate({ status: overrideStatus, force: true });
            }}
          >
            {mutation.isPending ? (
              <Loader2 className="mr-1.5 size-3 animate-spin" aria-hidden />
            ) : null}
            Set status
          </Button>
        </div>
      ) : null}

      {mutation.isError && (
        <span role="alert" className="text-sm text-danger">
          Unable to change the status: {(mutation.error as Error).message}
        </span>
      )}
    </div>
  );
}
