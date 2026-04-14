"use client";

import type { CSSProperties } from "react";
import { AlertCircle, Clock3, LaptopMinimal, MapPin, RefreshCw, Shield, ShieldOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccountSessions, useRevokeAccountSession } from "@/hooks/use-account-sessions";
import { useToast } from "@/hooks/use-toast";
import type { AccountSession, AccountSessionStatus } from "@/types/auth.types";

const STATUS_META: Record<
  AccountSessionStatus,
  {
    label: string;
    badgeClassName: string;
  }
> = {
  active: {
    label: "Active",
    badgeClassName: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
  },
  revoked: {
    label: "Revoked",
    badgeClassName: "border-amber-400/30 bg-amber-500/10 text-amber-100",
  },
  expired: {
    label: "Expired",
    badgeClassName: "border-slate-400/20 bg-slate-500/10 text-slate-300",
  },
};

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "Unavailable";

  return new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function detectBrowser(userAgent: string): string | null {
  if (/Edg\//i.test(userAgent)) return "Edge";
  if (/OPR\//i.test(userAgent)) return "Opera";
  if (/Chrome\//i.test(userAgent)) return "Chrome";
  if (/Firefox\//i.test(userAgent)) return "Firefox";
  if (/Safari\//i.test(userAgent) && !/Chrome\//i.test(userAgent)) return "Safari";
  return null;
}

function detectPlatform(userAgent: string): string | null {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "iOS";
  if (/Android/i.test(userAgent)) return "Android";
  if (/Windows/i.test(userAgent)) return "Windows";
  if (/Mac OS X|Macintosh/i.test(userAgent)) return "macOS";
  if (/Linux/i.test(userAgent)) return "Linux";
  return null;
}

function formatDeviceLabel(userAgent: string | null | undefined): string {
  if (!userAgent) return "Unknown device";

  const browser = detectBrowser(userAgent);
  const platform = detectPlatform(userAgent);

  if (browser && platform) return `${browser} on ${platform}`;
  if (browser) return browser;
  if (platform) return platform;

  return userAgent.length > 72 ? `${userAgent.slice(0, 72)}...` : userAgent;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Failed to load sessions";
}

function SessionStatusBadge({ status }: { status: AccountSessionStatus }) {
  const meta = STATUS_META[status];

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${meta.badgeClassName}`}
    >
      {meta.label}
    </span>
  );
}

function SessionCard({
  session,
  isRevoking,
  onRevoke,
}: {
  session: AccountSession;
  isRevoking: boolean;
  onRevoke: (sessionId: string) => void;
}) {
  const canRevoke = !session.is_current && session.status === "active";

  return (
    <div
      className="liquid-glass rounded-2xl border border-white/10 p-5"
      style={
        {
          "--lg-a": "15 23 42",
          "--lg-b": "30 41 59",
          "--lg-c": session.status === "active" ? "14 165 233" : "100 116 139",
        } as CSSProperties
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-200">
                <LaptopMinimal className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{formatDeviceLabel(session.user_agent)}</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {session.is_current ? "Current session" : "Saved session record"}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {session.is_current ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-sky-400/30 bg-sky-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-sky-100">
                <Shield className="h-3.5 w-3.5" />
                Current
              </span>
            ) : null}
            <SessionStatusBadge status={session.status} />
            {canRevoke ? (
              <Button variant="outline" size="sm" disabled={isRevoking} onClick={() => onRevoke(session.session_id)}>
                <ShieldOff className="h-4 w-4" />
                Revoke
              </Button>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 text-sm text-slate-300 md:grid-cols-2">
          <div className="rounded-xl border border-white/5 bg-black/10 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Signed In</p>
            <p className="mt-1">{formatTimestamp(session.login_at)}</p>
          </div>
          <div className="rounded-xl border border-white/5 bg-black/10 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Last Seen</p>
            <p className="mt-1">{formatTimestamp(session.last_seen_at)}</p>
          </div>
          <div className="rounded-xl border border-white/5 bg-black/10 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Expires</p>
            <p className="mt-1">{formatTimestamp(session.expires_at)}</p>
          </div>
          <div className="rounded-xl border border-white/5 bg-black/10 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {session.status === "revoked" ? "Revoked" : "IP Address"}
            </p>
            <p className="mt-1">
              {session.status === "revoked" ? formatTimestamp(session.revoked_at) : session.ip_address || "Unavailable"}
            </p>
          </div>
        </div>

        {session.user_agent ? (
          <div className="flex items-start gap-2 rounded-xl border border-white/5 bg-black/10 px-3 py-2 text-xs text-slate-400">
            <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="break-all">{session.user_agent}</span>
          </div>
        ) : null}

        {session.ip_address ? (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <MapPin className="h-3.5 w-3.5" />
            <span>{session.ip_address}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function AccountSessionsSection() {
  const { toast } = useToast();
  const { data, isLoading, isError, error, refetch } = useAccountSessions();
  const revokeSessionMutation = useRevokeAccountSession();

  const sessions = data ?? [];
  const currentSession = sessions.find((session) => session.is_current) ?? null;
  const otherActiveSessions = sessions.filter((session) => !session.is_current && session.status === "active");
  const sessionHistory = sessions.filter((session) => !session.is_current && session.status !== "active");

  const handleRevoke = (sessionId: string) => {
    revokeSessionMutation.mutate(sessionId, {
      onSuccess: () => {
        toast({
          title: "Session revoked",
          description: "The selected session was signed out.",
        });
      },
      onError: (mutationError) => {
        toast({
          title: "Failed to revoke session",
          description: getErrorMessage(mutationError),
          variant: "destructive",
        });
      },
    });
  };

  if (isLoading) {
    return (
      <div className="grid gap-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="liquid-glass rounded-2xl h-[220px] relative overflow-hidden"
            style={{ "--lg-a": "30 41 59", "--lg-b": "15 23 42", "--lg-c": "51 65 85" } as CSSProperties}
          >
            <Skeleton className="absolute inset-0 bg-transparent rounded-2xl" />
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="liquid-glass rounded-xl border border-red-500/30 p-4 text-sm bg-red-500/10 text-red-200">
        <p className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          {getErrorMessage(error)}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3 border-red-500/50 hover:bg-red-500/20 hover:text-red-100"
          onClick={() => {
            void refetch();
          }}
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Current</p>
          <p className="mt-2 text-2xl font-semibold text-white">{currentSession ? 1 : 0}</p>
          <p className="mt-1 text-sm text-slate-400">Session visible but not revocable from this list.</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Other Active</p>
          <p className="mt-2 text-2xl font-semibold text-white">{otherActiveSessions.length}</p>
          <p className="mt-1 text-sm text-slate-400">Other browsers and devices still signed in.</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">History</p>
          <p className="mt-2 text-2xl font-semibold text-white">{sessionHistory.length}</p>
          <p className="mt-1 text-sm text-slate-400">Expired and revoked sessions retained for history.</p>
        </div>
      </div>

      {currentSession ? (
        <section className="space-y-3">
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Current Session</h4>
            <p className="mt-1 text-sm text-slate-400">This browser stays protected from accidental self-revocation.</p>
          </div>
          <SessionCard
            session={currentSession}
            isRevoking={false}
            onRevoke={handleRevoke}
          />
        </section>
      ) : null}

      <section className="space-y-3">
        <div>
          <h4 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Other Active Sessions</h4>
          <p className="mt-1 text-sm text-slate-400">Revoke any session you no longer recognize or trust.</p>
        </div>
        {otherActiveSessions.length > 0 ? (
          <div className="grid gap-4">
            {otherActiveSessions.map((session) => (
              <SessionCard
                key={session.session_id}
                session={session}
                isRevoking={
                  revokeSessionMutation.isPending && revokeSessionMutation.variables === session.session_id
                }
                onRevoke={handleRevoke}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-sm text-slate-400">
            No other active sessions.
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h4 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Session History</h4>
          <p className="mt-1 text-sm text-slate-400">Historical session records grouped by login session.</p>
        </div>
        {sessionHistory.length > 0 ? (
          <div className="grid gap-4">
            {sessionHistory.map((session) => (
              <SessionCard key={session.session_id} session={session} isRevoking={false} onRevoke={handleRevoke} />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-sm text-slate-400">
            No historical sessions yet.
          </div>
        )}
      </section>
    </div>
  );
}
