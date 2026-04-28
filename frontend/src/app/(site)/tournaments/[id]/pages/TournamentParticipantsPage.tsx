"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Search,
  ShieldBan,
  UserPlus,
  XCircle,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useAuthProfile } from "@/hooks/useAuthProfile";
import { useColumnVisibility } from "@/hooks/useColumnVisibility";
import { tournamentQueryKeys } from "@/lib/tournament-query-keys";
import registrationService from "@/services/registration.service";
import type { Tournament } from "@/types/tournament.types";
import type { Registration, RegistrationStatus } from "@/types/registration.types";

import ColumnPicker from "./_components/ColumnPicker";
import { buildParticipantColumns } from "./_components/participantsColumns";

// ---------------------------------------------------------------------------
// Responsive class helper
// ---------------------------------------------------------------------------

const RESPONSIVE_CLASS: Record<string, string> = {
  always: "",
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
};

const ALIGN_CLASS: Record<"left" | "center", string> = {
  left: "text-left",
  center: "text-center",
};

// ---------------------------------------------------------------------------
// My registration status bar
// ---------------------------------------------------------------------------

const STATUS_BAR_CONFIG: Record<
  RegistrationStatus,
  { icon: typeof Clock; color: string; label: string }
> = {
  pending: {
    icon: Clock,
    color: "text-amber-400 border-amber-500/20 bg-amber-500/10",
    label: "Pending review",
  },
  approved: {
    icon: CheckCircle2,
    color: "text-emerald-400 border-emerald-500/20 bg-emerald-500/10",
    label: "Approved",
  },
  rejected: {
    icon: XCircle,
    color: "text-red-400 border-red-500/20 bg-red-500/10",
    label: "Rejected",
  },
  withdrawn: {
    icon: XCircle,
    color: "text-white/40 border-white/10 bg-white/5",
    label: "Withdrawn",
  },
  banned: {
    icon: ShieldBan,
    color: "text-red-400 border-red-500/20 bg-red-500/10",
    label: "Banned",
  },
  insufficient_data: {
    icon: AlertTriangle,
    color: "text-orange-400 border-orange-500/20 bg-orange-500/10",
    label: "Incomplete",
  },
};

function MyRegistrationBar({
  registration,
  canCheckIn,
  onCheckIn,
  onWithdraw,
  isCheckingIn,
  isWithdrawing,
}: {
  registration: Registration;
  canCheckIn: boolean;
  onCheckIn: () => void;
  onWithdraw: () => void;
  isCheckingIn: boolean;
  isWithdrawing: boolean;
}) {
  const config =
    STATUS_BAR_CONFIG[registration.status] ?? STATUS_BAR_CONFIG.pending;
  const StatusIcon = config.icon;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between",
        config.color,
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <StatusIcon className="size-4" />
        <span className="text-sm font-medium break-words">
          Your registration: {config.label}
        </span>
        {registration.battle_tag && (
          <span className="truncate text-xs opacity-60">
            ({registration.battle_tag})
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {canCheckIn && (
          <button
            type="button"
            onClick={onCheckIn}
            disabled={isCheckingIn}
            className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isCheckingIn ? "Checking in..." : "Check-in"}
          </button>
        )}
        {(registration.status === "pending" ||
          registration.status === "approved") && (
          <button
            type="button"
            onClick={onWithdraw}
            disabled={isWithdrawing || isCheckingIn}
            className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isWithdrawing ? "Withdrawing..." : "Withdraw"}
          </button>
        )}
      </div>
    </div>
  );
}

function isCheckInWindowActive(tournament: Tournament) {
  if (tournament.status !== "check_in") return false;

  const now = Date.now();
  const opensAt = tournament.check_in_opens_at
    ? new Date(tournament.check_in_opens_at).getTime()
    : null;
  const closesAt = tournament.check_in_closes_at
    ? new Date(tournament.check_in_closes_at).getTime()
    : null;

  return (opensAt === null || opensAt <= now) && (closesAt === null || now <= closesAt);
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
  const [isWithdrawDialogOpen, setIsWithdrawDialogOpen] = useState(false);
  const [isCheckInDialogOpen, setIsCheckInDialogOpen] = useState(false);

  const isAuthenticated = authStatus === "authenticated" && user !== null;

  const myRegQuery = useQuery({
    queryKey: tournamentQueryKeys.registration(tournament.workspace_id, tournament.id),
    queryFn: () =>
      registrationService.getMyRegistration(
        tournament.workspace_id,
        tournament.id,
      ),
    enabled: isAuthenticated,
  });

  const listQuery = useQuery({
    queryKey: tournamentQueryKeys.registrationsList(tournament.workspace_id, tournament.id),
    queryFn: () =>
      registrationService.listRegistrations(
        tournament.workspace_id,
        tournament.id,
      ),
  });

  const formQuery = useQuery({
    queryKey: tournamentQueryKeys.registrationForm(tournament.workspace_id, tournament.id),
    queryFn: () =>
      registrationService.getForm(tournament.workspace_id, tournament.id),
  });

  const withdrawMutation = useMutation({
    mutationFn: () =>
      registrationService.withdrawMyRegistration(
        tournament.workspace_id,
        tournament.id,
      ),
    onSuccess: async () => {
      setIsWithdrawDialogOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: tournamentQueryKeys.registration(tournament.workspace_id, tournament.id),
        }),
        queryClient.invalidateQueries({
          queryKey: tournamentQueryKeys.registrationsList(tournament.workspace_id, tournament.id),
        }),
        queryClient.invalidateQueries({
          queryKey: tournamentQueryKeys.registrationForm(tournament.workspace_id, tournament.id),
        }),
      ]);
    },
  });

  const checkInMutation = useMutation({
    mutationFn: () =>
      registrationService.checkInMyRegistration(
        tournament.workspace_id,
        tournament.id,
      ),
    onSuccess: async () => {
      setIsCheckInDialogOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: tournamentQueryKeys.registration(tournament.workspace_id, tournament.id),
        }),
        queryClient.invalidateQueries({
          queryKey: tournamentQueryKeys.registrationsList(tournament.workspace_id, tournament.id),
        }),
      ]);
    },
  });

  const registrations = listQuery.data ?? [];
  const myRegistration = myRegQuery.data;
  const form = formQuery.data ?? null;
  const canCheckIn =
    Boolean(myRegistration) &&
    myRegistration?.status === "approved" &&
    myRegistration.checked_in !== true &&
    isCheckInWindowActive(tournament);

  // Dynamic columns
  const allColumns = useMemo(
    () => buildParticipantColumns(form),
    [form],
  );
  const { visibleColumns, visibility, toggleColumn, resetToDefaults } =
    useColumnVisibility("participants-table-columns", allColumns);

  // Dynamic search across all searchable columns
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return registrations;
    const q = searchQuery.trim().toLowerCase();
    return registrations.filter((r) =>
      visibleColumns.some((col) => {
        if (!col.searchValue) return false;
        const val = col.searchValue(r);
        return val?.toLowerCase().includes(q) ?? false;
      }),
    );
  }, [registrations, searchQuery, visibleColumns]);

  return (
    <div className="space-y-5">
      {/* My registration status */}
      {myRegistration && (
        <MyRegistrationBar
          registration={myRegistration}
          canCheckIn={canCheckIn}
          onCheckIn={() => setIsCheckInDialogOpen(true)}
          onWithdraw={() => setIsWithdrawDialogOpen(true)}
          isCheckingIn={checkInMutation.isPending}
          isWithdrawing={withdrawMutation.isPending}
        />
      )}

      <AlertDialog
        open={isCheckInDialogOpen}
        onOpenChange={setIsCheckInDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm check-in?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark you as checked in for the tournament. Confirm only
              if you are ready to participate.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={checkInMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                checkInMutation.mutate();
              }}
              disabled={checkInMutation.isPending}
              className="border border-emerald-500/30 bg-emerald-600 text-white hover:bg-emerald-500"
            >
              {checkInMutation.isPending ? "Checking in..." : "Confirm check-in"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={isWithdrawDialogOpen}
        onOpenChange={setIsWithdrawDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Withdraw registration?</AlertDialogTitle>
            <AlertDialogDescription>
              Your application will be marked as withdrawn, and you will not be
              able to register for this tournament again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={withdrawMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                withdrawMutation.mutate();
              }}
              disabled={withdrawMutation.isPending}
              className="bg-red-600 text-white hover:bg-red-500"
            >
              {withdrawMutation.isPending ? "Withdrawing..." : "Confirm withdraw"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-white">
          Participants
          <span className="ml-2 text-sm font-normal text-white/40">
            {registrations.length}
          </span>
        </h2>
      </div>

      {/* Search + Column Picker */}
      {registrations.length > 0 && (
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/30" />
            <input
              type="text"
              placeholder="Search participants..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 w-full rounded-lg border border-white/10 bg-white/3 pl-9 pr-3 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-white/20"
            />
          </div>
          <ColumnPicker
            columns={allColumns}
            visibility={visibility}
            onToggle={toggleColumn}
            onReset={resetToDefaults}
          />
        </div>
      )}

      {/* Participants list */}
      {listQuery.isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-white/30" />
        </div>
      ) : filtered.length > 0 ? (
        <div className="overflow-x-auto overflow-hidden rounded-xl border border-white/[0.07]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.07] bg-white/2">
                {visibleColumns.map((col) => (
                  <th
                    key={col.id}
                    className={cn(
                      "px-2 py-2 text-xs font-medium uppercase tracking-wider text-white/40",
                      RESPONSIVE_CLASS[col.responsive ?? "always"],
                      ALIGN_CLASS[col.align ?? "left"],
                      col.widthClass,
                    )}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((reg, idx) => (
                <tr
                  key={reg.id}
                  className="border-b border-white/4 transition-colors hover:bg-white/2"
                >
                  {visibleColumns.map((col) => (
                    <td
                      key={col.id}
                      className={cn(
                        "px-2 py-2",
                        RESPONSIVE_CLASS[col.responsive ?? "always"],
                        ALIGN_CLASS[col.align ?? "left"],
                        col.widthClass,
                      )}
                    >
                      {col.render(reg, idx)}
                    </td>
                  ))}
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
