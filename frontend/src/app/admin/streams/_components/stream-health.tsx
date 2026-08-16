"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Clock,
  Gauge,
  Loader2,
  Pause,
  Play,
  Radio,
  Trophy
} from "lucide-react";

import { StatTile, StatTileGrid } from "@/components/admin/StatTile";
import { TONE_CLASS, type Tone } from "@/components/admin/tone";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthProfile } from "@/hooks/useAuthProfile";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import adminService from "@/services/admin.service";
import type { StreamPollHealth, StreamPollStatus } from "@/types/admin.types";

const STREAM_KEY = "stream.collection";

// The tick itself runs no faster than 30s (the setting's floor), so polling the
// panel harder than that only re-renders the same numbers. Matches the
// rank/subscription dashboards in kind, not in value: their sweeps are minutes
// apart, this one is seconds.
const REFETCH_MS = 30_000;

// ponytail: third copy of these two formatters (see `rank-shared.tsx` and
// `subscription-shared.tsx`) — the admin's convention is one self-contained
// `_components` folder per collector. Ceiling: a fourth copy. Upgrade path at
// that point is one `lib/format-duration.ts` and three import swaps, not a
// shared "admin utils" grab bag.

/** Compact "5m ago" / "2h ago" style relative time; falls back to "—". */
function formatRelative(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const diffSec = Math.round((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return "just now";
  const mins = Math.round(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function formatInterval(seconds: number): string {
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

/**
 * Wording and tone per recorded tick outcome.
 *
 * A registry rather than nested ternaries (the same reason `variant` in
 * `lib/tournament-status.ts` is a lookup): the compiler then holds this
 * exhaustive against `StreamPollStatus`, so a status added backend-side fails
 * the build here instead of silently rendering as a raw enum token.
 *
 * `hint` is the operator's next action, not a restatement of the label — the
 * whole reason this panel exists is that the tick swallows its own failures, so
 * "what went wrong" without "what to do" leaves them back in the logs.
 */
const STATUS_META: Record<StreamPollStatus, { label: string; tone: Tone; hint: string | null }> = {
  ok: { label: "Last tick OK", tone: "success", hint: null },
  empty: {
    label: "Nothing to poll",
    tone: "neutral",
    hint: "The last tick found no active tournament with a Twitch channel attached. Add a stream link to a live tournament to give the poller something to do."
  },
  truncated: {
    label: "Tick cut short",
    tone: "warning",
    hint: "More channels were due than one tick could cover. Raise the batch size (up to Twitch's 100 ceiling) or lower the interval so the backlog drains."
  },
  not_configured: {
    label: "Twitch credentials missing",
    tone: "danger",
    hint: "Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in backend/env/stream.env, then restart stream-service."
  },
  rate_limited: {
    label: "Helix rate limit reached",
    tone: "warning",
    hint: "The 800 requests/min bucket is shared with identity-service's OAuth sign-ins, so exhausting it breaks logins, not just stream badges. Fix it by RAISING the poll interval (or lowering the batch size) — not by retrying."
  },
  unauthorized: {
    label: "Twitch rejected the credentials",
    tone: "danger",
    hint: "The credentials are present but Twitch refused them. Re-check the client id/secret pair in the Twitch developer console (a rotated or deleted app reads exactly like this) and update backend/env/stream.env."
  },
  unavailable: {
    label: "Twitch unreachable",
    tone: "warning",
    hint: "Twitch did not answer. Nothing to do on our side — the next tick retries. If it persists, check the Twitch status page and this worker's egress."
  },
  error: {
    label: "Tick failed",
    tone: "danger",
    hint: "The tick raised an unexpected error. Check the stream-service logs for the traceback — the tick swallows failures to keep the scheduler alive, so nothing else surfaces it."
  }
};

interface Diagnosis {
  tone: Tone;
  label: string;
  hint: string | null;
}

/**
 * The one thing this panel owes the operator.
 *
 * Three unrelated causes all render as "a tournament page with no live badges",
 * and they need different actions. Resolved in this order because each earlier
 * cause makes the later ones unobservable: a disabled poller never records a
 * status at all, and missing credentials can't be "rejected".
 */
function diagnose(health: StreamPollHealth): Diagnosis {
  if (!health.enabled) {
    return {
      tone: "neutral",
      label: "Polling is off",
      hint: "This is the shipped default — a fresh deploy never touches Twitch. Turn on background polling in the Settings tab to start it."
    };
  }

  // Checked ahead of `status`: an operator who has just filled in the env sees
  // this flip before the next tick overwrites a stale `not_configured`.
  if (!health.credentials_configured) {
    return {
      tone: "danger",
      label: STATUS_META.not_configured.label,
      hint: STATUS_META.not_configured.hint
    };
  }

  if (health.status === null) {
    return {
      tone: "info",
      label: "No tick recorded yet",
      hint: "Polling is on and configured, but the scheduler has not reached a due tick. This is not a failure — give it one interval."
    };
  }

  return STATUS_META[health.status];
}

export function StreamHealthDashboard() {
  const queryClient = useQueryClient();
  const { user } = useAuthProfile();
  const isSuperuser = user?.isSuperuser ?? false;

  // No workspace in the key: one poller, one Redis key, one set of numbers.
  const healthQuery = useQuery({
    queryKey: ["admin", "streams", "health"],
    queryFn: () => adminService.getStreamPollHealth(),
    refetchInterval: REFETCH_MS
  });
  const health = healthQuery.data;

  const toggleMutation = useMutation({
    mutationFn: async () => {
      const setting = await adminService.getSetting(STREAM_KEY);
      const value = { ...(setting.value ?? {}), enabled: !(health?.enabled ?? false) };
      return adminService.updateSetting(STREAM_KEY, { value });
    },
    onSuccess: () => {
      notify.success(health?.enabled ? "Polling paused" : "Polling resumed");
      queryClient.invalidateQueries({ queryKey: ["admin", "streams"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "settings"] });
    },
    onError: (error) =>
      notify.apiError(error, { title: "Could not change the polling state — try again" })
  });

  if (healthQuery.isLoading || !health) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-full" />
        <StatTileGrid>
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </StatTileGrid>
      </div>
    );
  }

  const diagnosis = diagnose(health);
  // 800/min shared with identity-service sign-ins; a low reading is a sign-in
  // outage waiting to happen, so it is worth a tone rather than a bare number.
  const remaining = health.ratelimit_remaining;
  const rateTone: Tone = remaining == null ? "neutral" : remaining < 80 ? "danger" : "neutral";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Refetches every 30s — announce the pause/resume flip and the pacing. */}
        <div role="status" className="flex flex-wrap items-center gap-2 text-sm">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium",
              health.enabled ? TONE_CLASS.success : TONE_CLASS.neutral
            )}
          >
            <span
              aria-hidden
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                health.enabled ? "bg-success" : "bg-muted-foreground/40"
              )}
            />
            {health.enabled ? "Polling" : "Paused"}
          </span>
          <span className="text-muted-foreground">
            every <span className="tabular-nums">{formatInterval(health.interval_seconds)}</span> ·{" "}
            <span className="tabular-nums">{health.batch_size}</span>/batch
          </span>
        </div>
        {isSuperuser && (
          <Button
            variant="outline"
            size="sm"
            disabled={toggleMutation.isPending}
            onClick={() => toggleMutation.mutate()}
          >
            {toggleMutation.isPending ? (
              <Loader2 aria-hidden className="mr-1.5 h-4 w-4 animate-spin motion-reduce:animate-none" />
            ) : health.enabled ? (
              <Pause aria-hidden className="mr-1.5 h-4 w-4" />
            ) : (
              <Play aria-hidden className="mr-1.5 h-4 w-4" />
            )}
            {health.enabled ? "Pause polling" : "Resume polling"}
          </Button>
        )}
      </div>

      <div className={cn("space-y-1 rounded-xl border p-4 text-sm", TONE_CLASS[diagnosis.tone])}>
        <p className="flex items-center gap-2 font-medium">
          {diagnosis.tone === "danger" || diagnosis.tone === "warning" ? (
            <AlertTriangle aria-hidden className="h-4 w-4 shrink-0" />
          ) : null}
          {diagnosis.label}
        </p>
        {diagnosis.hint ? (
          <p className="text-muted-foreground">{diagnosis.hint}</p>
        ) : (
          <p className="text-muted-foreground">
            Last tick {formatRelative(health.last_run_at)}. Nothing to do.
          </p>
        )}
      </div>

      <StatTileGrid>
        <StatTile
          label="Last tick"
          value={formatRelative(health.last_run_at)}
          detail={
            health.status === null
              ? "Never run — no outcome recorded yet"
              : STATUS_META[health.status].label
          }
          icon={Clock}
          tone={diagnosis.tone}
        />

        <StatTile
          label="Tournaments"
          value={health.tournaments_active ?? "—"}
          detail={`${health.tournaments_updated ?? 0} changed state on the last tick`}
          icon={Trophy}
        />

        <StatTile
          label="Channels polled"
          value={health.channels_polled ?? "—"}
          detail="Twitch channels asked about on the last tick"
          icon={Radio}
        />

        <StatTile
          label="Live now"
          value={health.live_channels ?? "—"}
          detail="Channels Twitch reported as streaming"
          icon={Radio}
          tone={(health.live_channels ?? 0) > 0 ? "success" : "neutral"}
        />

        <StatTile
          label="Rate limit left"
          value={remaining ?? "—"}
          detail="Of an 800/min Helix bucket shared with sign-ins"
          icon={Gauge}
          tone={rateTone}
        />
      </StatTileGrid>
    </div>
  );
}
