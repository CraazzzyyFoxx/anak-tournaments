"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCircle2, Clock, Globe, Loader2, Lock, Pencil, Trash2, X, XCircle } from "lucide-react";

import { useBalancerTournamentId } from "@/app/balancer/_components/useBalancerTournamentId";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import balancerAdminService from "@/services/balancer-admin.service";
import type { AdminRegistration } from "@/types/balancer-admin.types";

type RegistrationStatusFilter = "all" | "pending" | "approved" | "rejected" | "withdrawn";

const STATUS_CONFIG: Record<string, { icon: typeof Clock; className: string; label: string }> = {
  pending: { icon: Clock, className: "text-amber-400", label: "Pending" },
  approved: { icon: CheckCircle2, className: "text-emerald-400", label: "Approved" },
  rejected: { icon: XCircle, className: "text-red-400", label: "Rejected" },
  withdrawn: { icon: XCircle, className: "text-muted-foreground", label: "Withdrawn" },
};

// ---------------------------------------------------------------------------
// Compact registration toggle bar
// ---------------------------------------------------------------------------

function RegistrationToggleBar({ tournamentId }: { tournamentId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const searchParams = useSearchParams();

  const formQuery = useQuery({
    queryKey: ["balancer-admin", "registration-form", tournamentId],
    queryFn: () => balancerAdminService.getRegistrationForm(tournamentId),
  });

  const toggleMutation = useMutation({
    mutationFn: (newOpen: boolean) =>
      balancerAdminService.upsertRegistrationForm(tournamentId, {
        is_open: newOpen,
        auto_approve: formQuery.data?.auto_approve ?? false,
        built_in_fields: formQuery.data?.built_in_fields_json ?? {},
        custom_fields: formQuery.data?.custom_fields_json ?? [],
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["balancer-admin", "registration-form", tournamentId] });
      toast({ title: formQuery.data?.is_open ? "Registration closed" : "Registration opened" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    },
  });

  const form = formQuery.data;
  const isOpen = form?.is_open ?? false;
  const query = searchParams.toString();
  const formHref = query ? `/balancer/registrations/form?${query}` : "/balancer/registrations/form";

  return (
    <div className="flex items-center justify-between rounded-lg border px-4 py-3">
      <div className="flex items-center gap-3">
        <Badge variant={isOpen ? "default" : "secondary"} className="gap-1.5">
          {isOpen ? <Globe className="size-3" /> : <Lock className="size-3" />}
          {isOpen ? "Open" : "Closed"}
        </Badge>
        <span className="text-sm text-muted-foreground">
          {isOpen ? "Players can register for this tournament." : "Registration is closed."}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" asChild>
          <Link href={formHref}>
            <Pencil className="mr-1.5 size-3.5" />
            Configure form
          </Link>
        </Button>
        <Switch
          checked={isOpen}
          onCheckedChange={(checked) => toggleMutation.mutate(checked)}
          disabled={toggleMutation.isPending || (!form && !isOpen)}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function BalancerRegistrationsPage() {
  const tournamentId = useBalancerTournamentId();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<RegistrationStatusFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const registrationsQuery = useQuery({
    queryKey: ["balancer-admin", "registrations", tournamentId],
    queryFn: () => balancerAdminService.listRegistrations(tournamentId as number),
    enabled: tournamentId !== null,
  });

  const approveMutation = useMutation({
    mutationFn: (registrationId: number) => balancerAdminService.approveRegistration(registrationId),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["balancer-admin", "registrations", tournamentId] });
      await queryClient.invalidateQueries({ queryKey: ["balancer-public", "applications", tournamentId] });
      await queryClient.invalidateQueries({ queryKey: ["balancer-public", "players", tournamentId] });
      toast({
        title: "Registration approved",
        description: result.player_id ? `Player #${result.player_id} created` : "Approved",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to approve", description: error.message, variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (registrationId: number) => balancerAdminService.rejectRegistration(registrationId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["balancer-admin", "registrations", tournamentId] });
      toast({ title: "Registration rejected" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to reject", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (registrationId: number) => balancerAdminService.deleteRegistration(registrationId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["balancer-admin", "registrations", tournamentId] });
      toast({ title: "Registration deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete", description: error.message, variant: "destructive" });
    },
  });

  const bulkApproveMutation = useMutation({
    mutationFn: () => {
      if (!tournamentId) throw new Error("No tournament selected");
      return balancerAdminService.bulkApproveRegistrations(tournamentId, Array.from(selectedIds));
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["balancer-admin", "registrations", tournamentId] });
      await queryClient.invalidateQueries({ queryKey: ["balancer-public", "applications", tournamentId] });
      await queryClient.invalidateQueries({ queryKey: ["balancer-public", "players", tournamentId] });
      setSelectedIds(new Set());
      toast({ title: `${result.approved} approved, ${result.skipped} skipped` });
    },
    onError: (error: Error) => {
      toast({ title: "Bulk approve failed", description: error.message, variant: "destructive" });
    },
  });

  const registrations = registrationsQuery.data ?? [];

  const filteredRegistrations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return registrations.filter((reg) => {
      if (statusFilter !== "all" && reg.status !== statusFilter) return false;
      if (!q) return true;
      return [reg.battle_tag, reg.discord_nick, reg.twitch_nick, reg.primary_role, reg.notes]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [registrations, statusFilter, searchQuery]);

  const pendingCount = registrations.filter((r) => r.status === "pending").length;

  const toggleSelection = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllPending = () => {
    setSelectedIds(new Set(filteredRegistrations.filter((r) => r.status === "pending").map((r) => r.id)));
  };

  if (!tournamentId) {
    return (
      <Alert>
        <AlertTitle>Select a tournament</AlertTitle>
        <AlertDescription>Choose a tournament in the sidebar before managing registrations.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      {/* Toggle bar */}
      <RegistrationToggleBar tournamentId={tournamentId} />

      {/* Registrations table */}
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Registrations</CardTitle>
              <CardDescription>
                {pendingCount > 0 && <>{pendingCount} pending. </>}
                Showing {filteredRegistrations.length} of {registrations.length}.
              </CardDescription>
            </div>
            {selectedIds.size > 0 && (
              <Button size="sm" onClick={() => bulkApproveMutation.mutate()} disabled={bulkApproveMutation.isPending}>
                {bulkApproveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                Approve {selectedIds.size} selected
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
          {/* Filters */}
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px]">
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by BattleTag, Discord, Twitch..."
            />
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as RegistrationStatusFilter)}>
              <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="withdrawn">Withdrawn</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {pendingCount > 0 && (
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={selectAllPending}>
                Select all pending ({pendingCount})
              </Button>
              {selectedIds.size > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                  Clear
                </Button>
              )}
            </div>
          )}

          {/* Table */}
          <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border/60">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>BattleTag</TableHead>
                  <TableHead>Discord</TableHead>
                  <TableHead>Twitch</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>Custom</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reviewed</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRegistrations.length > 0 ? (
                  filteredRegistrations.map((reg) => (
                    <RegistrationRow
                      key={reg.id}
                      registration={reg}
                      isSelected={selectedIds.has(reg.id)}
                      onToggleSelect={() => toggleSelection(reg.id)}
                      onApprove={() => approveMutation.mutate(reg.id)}
                      onReject={() => rejectMutation.mutate(reg.id)}
                      onDelete={() => deleteMutation.mutate(reg.id)}
                      isApproving={approveMutation.isPending}
                      isRejecting={rejectMutation.isPending}
                      isDeleting={deleteMutation.isPending}
                    />
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={11} className="py-8 text-center text-sm text-muted-foreground">
                      No registrations match the current filters.
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROLE_TO_ICON: Record<string, string> = {
  tank: "Tank",
  dps: "Damage",
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

const ROLE_LABELS: Record<string, string> = {
  tank: "Tank",
  dps: "DPS",
  support: "Support",
};

function RoleCell({ roles }: { roles: AdminRegistration["roles"] }) {
  if (!roles || roles.length === 0) return <span className="text-muted-foreground">—</span>;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {roles.map((r) => (
        <div
          key={r.role}
          className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 ${
            r.is_primary
              ? "border-border/80 bg-muted/40"
              : "border-border/40 bg-transparent opacity-60"
          }`}
          title={[
            ROLE_LABELS[r.role] ?? r.role,
            r.subrole ? SUBROLE_LABELS[r.subrole] ?? r.subrole : null,
            r.is_primary ? "(primary)" : null,
          ].filter(Boolean).join(" · ")}
        >
          <PlayerRoleIcon role={ROLE_TO_ICON[r.role] ?? r.role} size={16} />
          <span className="text-[11px] text-muted-foreground hidden lg:inline">
            {ROLE_LABELS[r.role] ?? r.role}
          </span>
          {r.subrole && (
            <span className="text-[10px] text-muted-foreground/60 hidden xl:inline">
              {SUBROLE_LABELS[r.subrole] ?? r.subrole}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function RegistrationRow({
  registration,
  isSelected,
  onToggleSelect,
  onApprove,
  onReject,
  onDelete,
  isApproving,
  isRejecting,
  isDeleting,
}: {
  registration: AdminRegistration;
  isSelected: boolean;
  onToggleSelect: () => void;
  onApprove: () => void;
  onReject: () => void;
  onDelete: () => void;
  isApproving: boolean;
  isRejecting: boolean;
  isDeleting: boolean;
}) {
  const customSummary = registration.custom_fields_json
    ? Object.entries(registration.custom_fields_json)
        .filter(([, v]) => v != null && v !== "")
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ")
    : "";

  return (
    <TableRow className={registration.status === "withdrawn" ? "opacity-50" : undefined}>
      <TableCell>
        {registration.status === "pending" && (
          <Checkbox checked={isSelected} onCheckedChange={onToggleSelect} />
        )}
      </TableCell>
      <TableCell className="font-medium">{registration.battle_tag ?? "—"}</TableCell>
      <TableCell>{registration.discord_nick ?? "—"}</TableCell>
      <TableCell>{registration.twitch_nick ?? "—"}</TableCell>
      <TableCell>
        <RoleCell roles={registration.roles} />
      </TableCell>
      <TableCell className="max-w-45 truncate text-xs text-muted-foreground" title={customSummary}>
        {customSummary || "—"}
      </TableCell>
      <TableCell className="text-xs">
        {registration.submitted_at ? new Date(registration.submitted_at).toLocaleString() : "—"}
      </TableCell>
      <TableCell>
        {(() => {
          const cfg = STATUS_CONFIG[registration.status] ?? STATUS_CONFIG.pending;
          const Icon = cfg.icon;
          return (
            <span className={`inline-flex items-center gap-1.5 ${cfg.className}`} title={cfg.label}>
              <Icon className="size-4" />
              <span className="text-xs">{cfg.label}</span>
            </span>
          );
        })()}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {registration.reviewed_at ? new Date(registration.reviewed_at).toLocaleString() : "—"}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {registration.reviewed_by_username ?? "—"}
      </TableCell>
      <TableCell>
        <div className="flex gap-1">
          {registration.status === "pending" && (
            <>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-green-600 hover:text-green-700" onClick={onApprove} disabled={isApproving} title="Approve">
                {isApproving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:text-red-700" onClick={onReject} disabled={isRejecting} title="Reject">
                {isRejecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
              </Button>
            </>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-600" onClick={onDelete} disabled={isDeleting} title="Delete">
            {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
