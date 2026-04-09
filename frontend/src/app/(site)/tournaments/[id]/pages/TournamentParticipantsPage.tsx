"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Clock,
  Loader2,
  Search,
  UserPlus,
  XCircle,
} from "lucide-react";

import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { cn } from "@/lib/utils";
import { useAuthProfile } from "@/hooks/useAuthProfile";
import registrationService from "@/services/registration.service";
import type { Tournament } from "@/types/tournament.types";
import type { Registration, RegistrationRole } from "@/types/registration.types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROLE_TO_ICON: Record<string, string> = {
  tank: "Tank",
  dps: "Damage",
  support: "Support",
};

const ROLE_LABELS: Record<string, string> = {
  tank: "Tank",
  dps: "DPS",
  support: "Support",
};

const SUBROLE_LABELS: Record<string, string> = {
  hitscan: "Hitscan",
  projectile: "Projectile",
  main_heal: "Main Heal",
  light_heal: "Light Heal",
  main_tank: "Main Tank",
  off_tank: "Off Tank",
  flanker: "Flanker",
  flex_dps: "Flex DPS",
  flex_support: "Flex Support",
};

function RolesCell({ roles }: { roles: RegistrationRole[] }) {
  if (!roles || roles.length === 0) return <span className="text-white/30">—</span>;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {roles.map((r) => (
        <span
          key={r.role}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium",
            r.is_primary
              ? "border-white/10 bg-white/5 text-white/70"
              : "border-white/5 text-white/40",
          )}
          title={[
            ROLE_LABELS[r.role] ?? r.role,
            r.subrole ? SUBROLE_LABELS[r.subrole] ?? r.subrole : null,
            r.is_primary ? "(primary)" : null,
          ].filter(Boolean).join(" · ")}
        >
          <PlayerRoleIcon role={ROLE_TO_ICON[r.role] ?? r.role} size={14} />
          {ROLE_LABELS[r.role] ?? r.role}
          {r.subrole && (
            <span className="text-[10px] opacity-60">{SUBROLE_LABELS[r.subrole] ?? r.subrole}</span>
          )}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// My registration status bar
// ---------------------------------------------------------------------------

function MyRegistrationBar({
  registration,
  onWithdraw,
  isWithdrawing,
}: {
  registration: Registration;
  onWithdraw: () => void;
  isWithdrawing: boolean;
}) {
  const statusConfig: Record<string, { icon: typeof Clock; color: string; label: string }> = {
    pending: { icon: Clock, color: "text-amber-400 border-amber-500/20 bg-amber-500/10", label: "Pending review" },
    approved: { icon: CheckCircle2, color: "text-emerald-400 border-emerald-500/20 bg-emerald-500/10", label: "Approved" },
    rejected: { icon: XCircle, color: "text-red-400 border-red-500/20 bg-red-500/10", label: "Rejected" },
    withdrawn: { icon: XCircle, color: "text-white/40 border-white/10 bg-white/5", label: "Withdrawn" },
  };

  const config = statusConfig[registration.status] ?? statusConfig.pending;
  const StatusIcon = config.icon;

  return (
    <div className={cn("flex items-center justify-between rounded-lg border p-3", config.color)}>
      <div className="flex items-center gap-2.5">
        <StatusIcon className="size-4" />
        <span className="text-sm font-medium">Your registration: {config.label}</span>
        {registration.battle_tag && (
          <span className="text-xs opacity-60">({registration.battle_tag})</span>
        )}
      </div>
      {(registration.status === "pending" || registration.status === "approved") && (
        <button
          type="button"
          onClick={onWithdraw}
          disabled={isWithdrawing}
          className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-500/20"
        >
          {isWithdrawing ? "Withdrawing..." : "Withdraw"}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function TournamentParticipantsPage({
  tournament,
}: {
  tournament: Tournament;
}) {
  const { user, status: authStatus } = useAuthProfile();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");

  const isAuthenticated = authStatus === "authenticated" && user !== null;

  const myRegQuery = useQuery({
    queryKey: ["registration", tournament.workspace_id, tournament.id],
    queryFn: () => registrationService.getMyRegistration(tournament.workspace_id, tournament.id),
    enabled: isAuthenticated,
  });

  const listQuery = useQuery({
    queryKey: ["registrations-list", tournament.workspace_id, tournament.id],
    queryFn: () => registrationService.listRegistrations(tournament.workspace_id, tournament.id),
  });

  const withdrawMutation = useMutation({
    mutationFn: () => registrationService.withdrawMyRegistration(tournament.workspace_id, tournament.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["registration", tournament.workspace_id, tournament.id] }),
        queryClient.invalidateQueries({ queryKey: ["registrations-list", tournament.workspace_id, tournament.id] }),
        queryClient.invalidateQueries({ queryKey: ["registration-form", tournament.workspace_id, tournament.id] }),
      ]);
    },
  });

  const registrations = listQuery.data ?? [];
  const myRegistration = myRegQuery.data;
  const alreadyRegistered = myRegistration != null && myRegistration.status !== "withdrawn";

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return registrations;
    const q = searchQuery.trim().toLowerCase();
    return registrations.filter(
      (r) =>
        r.battle_tag?.toLowerCase().includes(q) ||
        r.discord_nick?.toLowerCase().includes(q) ||
        r.twitch_nick?.toLowerCase().includes(q) ||
        r.roles?.some((role) => role.role.toLowerCase().includes(q)),
    );
  }, [registrations, searchQuery]);

  return (
    <div className="space-y-5">
      {/* My registration status */}
      {myRegistration && alreadyRegistered && (
        <MyRegistrationBar
          registration={myRegistration}
          onWithdraw={() => withdrawMutation.mutate()}
          isWithdrawing={withdrawMutation.isPending}
        />
      )}

      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-white">
          Participants
          <span className="ml-2 text-sm font-normal text-white/40">
            {registrations.length}
          </span>
        </h2>
      </div>

      {/* Search */}
      {registrations.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/30" />
          <input
            type="text"
            placeholder="Search participants..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 w-full rounded-lg border border-white/10 bg-white/3 pl-9 pr-3 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-white/20"
          />
        </div>
      )}

      {/* Participants list */}
      {listQuery.isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-white/30" />
        </div>
      ) : filtered.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-white/[0.07]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.07] bg-white/2">
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-white/40">#</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-white/40">BattleTag</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-white/40">Roles</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-white/40">Discord</th>
                <th className="hidden px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-white/40 sm:table-cell">Twitch</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((reg, idx) => (
                <tr
                  key={reg.id}
                  className="border-b border-white/4 transition-colors hover:bg-white/2"
                >
                  <td className="px-4 py-2.5 text-white/30 tabular-nums">{idx + 1}</td>
                  <td className="px-4 py-2.5 font-medium text-white/80">{reg.battle_tag ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <RolesCell roles={reg.roles} />
                  </td>
                  <td className="px-4 py-2.5 text-white/50">{reg.discord_nick ?? "—"}</td>
                  <td className="hidden px-4 py-2.5 text-white/50 sm:table-cell">{reg.twitch_nick ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-xl border border-white/[0.07] bg-white/2 py-16 text-center">
          <UserPlus className="size-10 text-white/15" />
          <p className="mt-3 text-sm text-white/40">
            No participants registered yet.
          </p>
        </div>
      )}
    </div>
  );
}
