"use client";

import { type Dispatch, type SetStateAction, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BadgeInfo,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  Globe,
  Loader2,
  Lock,
  MessageSquareText,
  RadioTower,
  Pencil,
  ShieldBan,
  ShieldX,
  Trash2,
  Undo2,
  UserPlus,
  UserRound,
  X,
  XCircle,
} from "lucide-react";

import FieldLabel from "@/app/(site)/tournaments/[id]/_components/registration/FieldLabel";
import StepIndicator from "@/app/(site)/tournaments/[id]/_components/registration/StepIndicator";
import { useBalancerTournamentId } from "@/app/balancer/_components/useBalancerTournamentId";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useDivisionGrid } from "@/hooks/useCurrentWorkspace";
import { useToast } from "@/hooks/use-toast";
import balancerAdminService from "@/services/balancer-admin.service";
import type {
  AdminGoogleSheetFeed,
  AdminRegistration,
  AdminRegistrationRole,
  BalancerRoleCode,
  BalancerRoleSubtype,
} from "@/types/balancer-admin.types";
import type { DivisionGrid } from "@/types/workspace.types";
import { resolveDivisionFromRankHelper } from "@/app/balancer/_components/workspace-helpers";
import { cn } from "@/lib/utils";

type RegistrationStatusFilter = "all" | "pending" | "approved" | "rejected" | "withdrawn" | "banned" | "insufficient_data";
type InclusionFilter = "all" | "included" | "excluded";
type SourceFilter = "all" | "manual" | "google_sheets";

const ROLE_OPTIONS: BalancerRoleCode[] = ["tank", "dps", "support"];
const ROLE_LABELS: Record<BalancerRoleCode, string> = {
  tank: "Tank",
  dps: "Damage",
  support: "Support",
};
const SUBROLE_OPTIONS: Record<Exclude<BalancerRoleCode, "tank">, Array<{ value: BalancerRoleSubtype; label: string }>> = {
  dps: [
    { value: "hitscan", label: "Hitscan" },
    { value: "projectile", label: "Projectile" },
  ],
  support: [
    { value: "main_heal", label: "Main heal" },
    { value: "light_heal", label: "Light heal" },
  ],
};

const ADMIN_FORM_STEPS = [
  { label: "Accounts" },
  { label: "Roles" },
  { label: "Details" },
];

const ADMIN_ROLE_ACCENTS: Record<BalancerRoleCode, { tile: string; selectedCard: string; badge: string }> = {
  tank: {
    tile: "bg-sky-500/18 text-sky-200",
    selectedCard: "border-sky-400/60 bg-sky-500/[0.08] shadow-[0_0_0_1px_rgba(56,189,248,0.12)]",
    badge: "border-sky-400/20 bg-sky-500/10 text-sky-200",
  },
  dps: {
    tile: "bg-orange-500/18 text-orange-200",
    selectedCard: "border-orange-400/60 bg-orange-500/[0.08] shadow-[0_0_0_1px_rgba(249,115,22,0.12)]",
    badge: "border-orange-400/20 bg-orange-500/10 text-orange-200",
  },
  support: {
    tile: "bg-emerald-500/18 text-emerald-200",
    selectedCard: "border-emerald-400/60 bg-emerald-500/[0.08] shadow-[0_0_0_1px_rgba(16,185,129,0.12)]",
    badge: "border-emerald-400/20 bg-emerald-500/10 text-emerald-200",
  },
};

const ADMIN_INPUT_CLASS =
  "h-11 rounded-xl border-white/10 bg-white/[0.03] text-white placeholder:text-white/28 focus-visible:ring-0 focus-visible:border-white/20";
const ADMIN_TEXTAREA_CLASS =
  "min-h-[120px] rounded-xl border-white/10 bg-white/[0.03] text-white placeholder:text-white/28 focus-visible:ring-0 focus-visible:border-white/20";

const STATUS_CONFIG: Record<string, { icon: typeof Clock; className: string; label: string }> = {
  pending: { icon: Clock, className: "text-amber-500", label: "Pending" },
  approved: { icon: CheckCircle2, className: "text-emerald-500", label: "Approved" },
  rejected: { icon: XCircle, className: "text-red-500", label: "Rejected" },
  withdrawn: { icon: Undo2, className: "text-muted-foreground", label: "Withdrawn" },
  banned: { icon: ShieldBan, className: "text-red-500", label: "Banned" },
  insufficient_data: { icon: AlertTriangle, className: "text-orange-500", label: "Incomplete" },
};

function RegistrationToggleBar({ tournamentId }: { tournamentId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const searchParams = useSearchParams();

  const formQuery = useQuery({
    queryKey: ["balancer-admin", "registration-form", tournamentId],
    queryFn: () => balancerAdminService.getRegistrationForm(tournamentId),
  });

  const toggleMutation = useMutation({
    mutationFn: (nextValue: boolean) =>
      balancerAdminService.upsertRegistrationForm(tournamentId, {
        is_open: nextValue,
        auto_approve: formQuery.data?.auto_approve ?? false,
        built_in_fields: formQuery.data?.built_in_fields_json ?? {},
        custom_fields: formQuery.data?.custom_fields_json ?? [],
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["balancer-admin", "registration-form", tournamentId] });
      toast({ title: formQuery.data?.is_open ? "Registration closed" : "Registration opened" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update form", description: error.message, variant: "destructive" });
    },
  });

  const form = formQuery.data;
  const isOpen = form?.is_open ?? false;
  const formHref = searchParams.toString()
    ? `/balancer/registrations/form?${searchParams.toString()}`
    : "/balancer/registrations/form";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3">
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

function RolesCell({ roles }: { roles: AdminRegistration["roles"] }) {
  if (roles.length === 0) {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {roles
        .slice()
        .sort((left, right) => left.priority - right.priority)
        .map((role) => (
          <div
            key={`${role.role}-${role.priority}`}
            className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs"
            title={role.rank_value != null ? `${role.role} ${role.rank_value}` : role.role}
          >
            <PlayerRoleIcon role={role.role === "dps" ? "Damage" : role.role === "tank" ? "Tank" : "Support"} size={14} />
            <span>{role.role}</span>
            {role.rank_value != null ? <span className="text-muted-foreground">{role.rank_value}</span> : null}
          </div>
        ))}
    </div>
  );
}

function SourceBadge({ source }: { source: AdminRegistration["source"] }) {
  return (
    <Badge variant={source === "google_sheets" ? "secondary" : "outline"}>
      {source === "google_sheets" ? "Google Sheets" : "Manual"}
    </Badge>
  );
}

function BalancerBadge({ registration }: { registration: AdminRegistration }) {
  const status = registration.balancer_status ?? "not_in_balancer";
  const config: Record<string, { variant: "default" | "outline" | "destructive"; label: string }> = {
    not_in_balancer: { variant: "outline", label: "Not Added" },
    incomplete: { variant: "destructive", label: "Incomplete" },
    ready: { variant: "default", label: "Ready" },
  };
  const { variant, label } = config[status] ?? config.not_in_balancer;
  return <Badge variant={variant}>{label}</Badge>;
}

function CheckInBadge({ registration }: { registration: AdminRegistration }) {
  return (
    <Badge variant={registration.checked_in ? "default" : "outline"}>
      {registration.checked_in ? "Checked In" : "Not Checked In"}
    </Badge>
  );
}

type ManualDraft = {
  display_name: string;
  battle_tag: string;
  smurf_tags: string;
  discord_nick: string;
  twitch_nick: string;
  notes: string;
  admin_notes: string;
  is_flex: boolean;
  stream_pov: boolean;
  roles: Record<BalancerRoleCode, RoleDraft>;
};

type RoleDraft = {
  enabled: boolean;
  rank_value: string;
  subrole: BalancerRoleSubtype | "";
  is_primary: boolean;
  priority: string;
};

function createRoleDraft(role: BalancerRoleCode): RoleDraft {
  return {
    enabled: false,
    rank_value: "",
    subrole: "",
    is_primary: role === "tank",
    priority: String(ROLE_OPTIONS.indexOf(role) + 1),
  };
}

function createEmptyManualDraft(): ManualDraft {
  return {
    display_name: "",
    battle_tag: "",
    smurf_tags: "",
    discord_nick: "",
    twitch_nick: "",
    notes: "",
    admin_notes: "",
    is_flex: false,
    stream_pov: false,
    roles: {
      tank: createRoleDraft("tank"),
      dps: createRoleDraft("dps"),
      support: createRoleDraft("support"),
    },
  };
}

function buildManualDraftFromRegistration(registration: AdminRegistration): ManualDraft {
  const draft = createEmptyManualDraft();
  draft.display_name = registration.display_name ?? "";
  draft.battle_tag = registration.battle_tag ?? "";
  draft.smurf_tags = registration.smurf_tags_json.join(", ");
  draft.discord_nick = registration.discord_nick ?? "";
  draft.twitch_nick = registration.twitch_nick ?? "";
  draft.notes = registration.notes ?? "";
  draft.admin_notes = registration.admin_notes ?? "";
  draft.is_flex = registration.is_flex;
  draft.stream_pov = registration.stream_pov;

  for (const role of registration.roles) {
    draft.roles[role.role] = {
      enabled: role.is_active || role.rank_value !== null,
      rank_value: role.rank_value != null ? String(role.rank_value) : "",
      subrole: role.subrole ?? "",
      is_primary: role.is_primary,
      priority: String(role.priority + 1),
    };
  }

  return draft;
}

function normalizeSmurfTags(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildRolePayload(roles: ManualDraft["roles"], isFlex: boolean): AdminRegistrationRole[] {
  const enabledRoles = ROLE_OPTIONS.filter((role) => roles[role].enabled).sort((left, right) => {
    const leftPriority = Number(roles[left].priority) || ROLE_OPTIONS.indexOf(left) + 1;
    const rightPriority = Number(roles[right].priority) || ROLE_OPTIONS.indexOf(right) + 1;
    return leftPriority - rightPriority;
  });

  const explicitPrimary = enabledRoles.find((role) => roles[role].is_primary) ?? enabledRoles[0] ?? null;

  return enabledRoles.map((role, index) => {
    const draft = roles[role];
    const parsedRankValue = draft.rank_value.trim() ? Number(draft.rank_value) : null;
    return {
      role,
      subrole: role === "tank" ? null : draft.subrole || null,
      is_primary: isFlex || explicitPrimary === role,
      priority: Number(draft.priority) || index + 1,
      rank_value: Number.isFinite(parsedRankValue) ? parsedRankValue : null,
      is_active: true,
    };
  });
}

function getDivisionLabel(rankValue: string, divisionGrid: DivisionGrid): string | null {
  if (!rankValue.trim()) {
    return null;
  }
  const parsedRankValue = Number(rankValue);
  if (!Number.isFinite(parsedRankValue)) {
    return null;
  }
  const divisionNumber = resolveDivisionFromRankHelper(parsedRankValue, divisionGrid);
  if (divisionNumber === null) {
    return null;
  }
  const division = divisionGrid.tiers.find((tier) => tier.number === divisionNumber);
  return division?.name ?? `Division ${divisionNumber}`;
}

const EMPTY_MANUAL_DRAFT: ManualDraft = createEmptyManualDraft();

function FeedStatus({ feed }: { feed: AdminGoogleSheetFeed | null | undefined }) {
  if (!feed) {
    return (
      <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
        No Google Sheets feed configured yet.
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{feed.last_sync_status ?? "pending"}</Badge>
        <span className="text-muted-foreground">
          Last sync: {feed.last_synced_at ? new Date(feed.last_synced_at).toLocaleString() : "never"}
        </span>
      </div>
      {feed.last_error ? <p className="mt-2 text-sm text-destructive">{feed.last_error}</p> : null}
      {feed.header_row_json?.length ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Headers detected: {feed.header_row_json.join(", ")}
        </p>
      ) : null}
    </div>
  );
}

function FeedSummaryCard({
  feed,
  href,
}: {
  feed: AdminGoogleSheetFeed | null | undefined;
  href: string;
}) {
  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Google Sheets Feed</CardTitle>
            <CardDescription>Feed configuration and mapping live on a dedicated subpage.</CardDescription>
          </div>
          <Button variant="outline" asChild>
            <Link href={href}>
              Open feed settings
              <ExternalLink className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <FeedStatus feed={feed} />
      </CardContent>
    </Card>
  );
}

function RegistrationProfileForm({
  draft,
  setDraft,
  divisionGrid,
}: {
  draft: ManualDraft;
  setDraft: Dispatch<SetStateAction<ManualDraft>>;
  divisionGrid: DivisionGrid;
}) {
  const updateRoleDraft = (
    role: BalancerRoleCode,
    updater: (current: RoleDraft) => RoleDraft,
  ) => {
    setDraft((current) => ({
      ...current,
      roles: {
        ...current.roles,
        [role]: updater(current.roles[role]),
      },
    }));
  };

  const setPrimaryRole = (targetRole: BalancerRoleCode, checked: boolean) => {
    setDraft((current) => ({
      ...current,
      roles: Object.fromEntries(
        ROLE_OPTIONS.map((candidateRole) => [
          candidateRole,
          {
            ...current.roles[candidateRole],
            is_primary: checked === true ? candidateRole === targetRole && current.roles[candidateRole].enabled : false,
          },
        ]),
      ) as ManualDraft["roles"],
    }));
  };

  const selectedRoles = ROLE_OPTIONS.filter((role) => draft.roles[role].enabled);
  const primaryRoles = selectedRoles.filter((role) => draft.roles[role].is_primary);

  return (
    <div className="overflow-hidden rounded-[30px] border border-white/10 bg-[#09090f]">
      <div className="relative overflow-hidden border-b border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.12),transparent_35%),linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0))] px-6 py-6 sm:px-7">
        <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.08),transparent_55%)]" />
        <div className="relative space-y-5">
          <div className="space-y-2">
            <FieldLabel label="Admin Registration Flow" icon={<BadgeInfo className="size-3.5" />} />
            <div className="space-y-2">
              <h3 className="text-2xl font-semibold tracking-tight text-white">Fixed multi-step editor</h3>
              <p className="max-w-3xl text-sm leading-6 text-white/50">
                Built-in admin fields stay pinned in one view and follow the public registration rhythm. Only custom fields are
                expected to vary outside this shell.
              </p>
            </div>
          </div>

          <StepIndicator steps={ADMIN_FORM_STEPS} current={0} />

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <FieldLabel label="Accounts" icon={<UserRound className="size-3.5" />} />
              <p className="mt-3 text-2xl font-semibold text-white">{draft.battle_tag.trim() || "New participant"}</p>
              <p className="mt-1 text-sm text-white/45">Primary identity stays visible at the top just like the public flow.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <FieldLabel label="Roles" icon={<RadioTower className="size-3.5" />} />
              <p className="mt-3 text-2xl font-semibold text-white">{selectedRoles.length}</p>
              <p className="mt-1 text-sm text-white/45">
                {draft.is_flex
                  ? "Flex is enabled, so every selected role will be saved as primary."
                  : `${primaryRoles.length} primary role${primaryRoles.length === 1 ? "" : "s"} selected.`}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <FieldLabel label="Admin Notes" icon={<MessageSquareText className="size-3.5" />} />
              <p className="mt-3 text-sm leading-6 text-white/55">
                Public and internal notes stay in the fixed details block, so the edit surface remains predictable.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 px-6 py-6 sm:px-7">
        <section className="rounded-[26px] border border-white/10 bg-white/[0.02] p-5 sm:p-6">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <FieldLabel label="Accounts" icon={<UserRound className="size-3.5" />} />
              <div>
                <h4 className="text-lg font-semibold text-white">Identity and contact handles</h4>
                <p className="text-sm leading-6 text-white/45">
                  Same order as the public registration, but with every admin field visible all the time.
                </p>
              </div>
            </div>
            <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs uppercase tracking-[0.16em] text-white/40">
              Step 1
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <FieldLabel label="Display Name" icon={<UserRound className="size-3.5" />} />
              <Input
                className={ADMIN_INPUT_CLASS}
                value={draft.display_name}
                onChange={(event) => setDraft((current) => ({ ...current, display_name: event.target.value }))}
                placeholder="Display name"
              />
            </div>
            <div className="space-y-2">
              <FieldLabel label="BattleTag" required icon={<BadgeInfo className="size-3.5" />} />
              <Input
                className={ADMIN_INPUT_CLASS}
                value={draft.battle_tag}
                onChange={(event) => setDraft((current) => ({ ...current, battle_tag: event.target.value }))}
                placeholder="ZOZO#21416"
              />
            </div>
            <div className="space-y-2 lg:col-span-2">
              <FieldLabel label="Smurf BattleTags" icon={<BadgeInfo className="size-3.5" />} />
              <Input
                className={ADMIN_INPUT_CLASS}
                value={draft.smurf_tags}
                onChange={(event) => setDraft((current) => ({ ...current, smurf_tags: event.target.value }))}
                placeholder="Smurf BattleTags, comma-separated"
              />
            </div>
            <div className="space-y-2">
              <FieldLabel label="Discord" icon={<MessageSquareText className="size-3.5" />} />
              <Input
                className={ADMIN_INPUT_CLASS}
                value={draft.discord_nick}
                onChange={(event) => setDraft((current) => ({ ...current, discord_nick: event.target.value }))}
                placeholder="Discord nickname"
              />
            </div>
            <div className="space-y-2">
              <FieldLabel label="Twitch" icon={<RadioTower className="size-3.5" />} />
              <Input
                className={ADMIN_INPUT_CLASS}
                value={draft.twitch_nick}
                onChange={(event) => setDraft((current) => ({ ...current, twitch_nick: event.target.value }))}
                placeholder="Twitch channel"
              />
            </div>
          </div>
        </section>

        <section className="rounded-[26px] border border-white/10 bg-white/[0.02] p-5 sm:p-6">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <FieldLabel label="Roles" icon={<RadioTower className="size-3.5" />} />
              <div>
                <h4 className="text-lg font-semibold text-white">Role profile and balancer signals</h4>
                <p className="text-sm leading-6 text-white/45">
                  Public role selection styling, with the full admin payload pinned: rank, priority, subrole and primary state.
                </p>
              </div>
            </div>
            <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs uppercase tracking-[0.16em] text-white/40">
              Step 2
            </div>
          </div>

          <div className="grid gap-4">
            {ROLE_OPTIONS.map((role) => {
              const roleDraft = draft.roles[role];
              const divisionLabel = getDivisionLabel(roleDraft.rank_value, divisionGrid);
              const accents = ADMIN_ROLE_ACCENTS[role];

              return (
                <div
                  key={role}
                  className={cn(
                    "rounded-[24px] border p-4 transition-all sm:p-5",
                    roleDraft.enabled
                      ? accents.selectedCard
                      : "border-white/10 bg-black/20 hover:border-white/16 hover:bg-white/[0.03]",
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="pt-1">
                        <Checkbox
                          checked={roleDraft.enabled}
                          onCheckedChange={(checked) =>
                            updateRoleDraft(role, (current) => ({
                              ...current,
                              enabled: checked === true,
                              is_primary: checked === true ? current.is_primary : false,
                            }))
                          }
                        />
                      </div>
                      <div className="flex items-start gap-3">
                        <div
                          className={cn(
                            "flex size-12 shrink-0 items-center justify-center rounded-2xl border border-white/10",
                            accents.tile,
                          )}
                        >
                          <PlayerRoleIcon role={ROLE_LABELS[role]} size={20} />
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-base font-semibold text-white">{ROLE_LABELS[role]}</span>
                            <Badge
                              variant="outline"
                              className={cn("rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.14em]", accents.badge)}
                            >
                              {roleDraft.enabled ? "Selected" : "Optional"}
                            </Badge>
                          </div>
                          <p className="text-sm leading-6 text-white/45">
                            {role === "tank"
                              ? "Single-role card with rank and primary preference."
                              : "Balancer-facing role card with subrole and ordering controls."}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="rounded-full border-white/10 bg-black/20 px-2.5 py-1 text-white/55">
                        {roleDraft.enabled ? divisionLabel ?? "Division pending rank" : "Role disabled"}
                      </Badge>
                      {roleDraft.enabled ? (
                        <Badge variant="outline" className="rounded-full border-white/10 bg-black/20 px-2.5 py-1 text-white/55">
                          Priority {roleDraft.priority || "?"}
                        </Badge>
                      ) : null}
                    </div>
                  </div>

                  {roleDraft.enabled ? (
                    <div className="mt-5 grid gap-4">
                      <div className="grid gap-4 lg:grid-cols-3">
                        <div className="space-y-2">
                          <FieldLabel label="Rank Value" />
                          <Input
                            className={ADMIN_INPUT_CLASS}
                            inputMode="numeric"
                            value={roleDraft.rank_value}
                            onChange={(event) => updateRoleDraft(role, (current) => ({ ...current, rank_value: event.target.value }))}
                            placeholder="e.g. 1450"
                          />
                        </div>
                        <div className="space-y-2">
                          <FieldLabel label="Priority" />
                          <Input
                            className={ADMIN_INPUT_CLASS}
                            inputMode="numeric"
                            value={roleDraft.priority}
                            onChange={(event) => updateRoleDraft(role, (current) => ({ ...current, priority: event.target.value }))}
                            placeholder="1"
                          />
                        </div>
                        <div className="space-y-2">
                          <FieldLabel label="Subrole" />
                          {role === "tank" ? (
                            <div className="flex h-11 items-center rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white/38">
                              Tank does not use a subrole.
                            </div>
                          ) : (
                            <Select
                              value={roleDraft.subrole || "none"}
                              onValueChange={(value) =>
                                updateRoleDraft(role, (current) => ({
                                  ...current,
                                  subrole: value === "none" ? "" : (value as BalancerRoleSubtype),
                                }))
                              }
                            >
                              <SelectTrigger className={ADMIN_INPUT_CLASS}>
                                <SelectValue placeholder="Optional" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">None</SelectItem>
                                {SUBROLE_OPTIONS[role].map((option) => (
                                  <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <FieldLabel label="Primary Role" />
                            <p className="mt-2 text-sm leading-6 text-white/45">
                              {draft.is_flex
                                ? "Flex mode is authoritative here: every enabled role will be saved as primary."
                                : "Use a single explicit primary role when flex is disabled."}
                            </p>
                          </div>
                          <label
                            className={cn(
                              "flex items-center gap-3 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                              draft.is_flex
                                ? "cursor-not-allowed border-white/10 bg-white/[0.03] text-white/30"
                                : "cursor-pointer border-white/10 bg-white/[0.03] text-white/80 hover:border-white/20",
                            )}
                          >
                            <Checkbox
                              checked={roleDraft.is_primary}
                              disabled={draft.is_flex}
                              onCheckedChange={(checked) => setPrimaryRole(role, checked === true)}
                            />
                            Primary role
                          </label>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="mt-4 rounded-[24px] border border-white/10 bg-black/20 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="max-w-2xl">
                <FieldLabel label="Flex" icon={<RadioTower className="size-3.5" />} />
                <h5 className="mt-2 text-base font-semibold text-white">Make the role profile fully flex</h5>
                <p className="mt-1 text-sm leading-6 text-white/45">
                  When enabled, all selected roles are saved as primary. Individual primary toggles stay visible but are locked to
                  keep the payload unambiguous.
                </p>
              </div>
              <Switch
                checked={draft.is_flex}
                onCheckedChange={(checked) =>
                  setDraft((current) => ({
                    ...current,
                    is_flex: checked,
                    roles: checked
                      ? Object.fromEntries(
                          ROLE_OPTIONS.map((role) => [
                            role,
                            {
                              ...current.roles[role],
                              is_primary: current.roles[role].enabled ? true : current.roles[role].is_primary,
                            },
                          ]),
                        ) as ManualDraft["roles"]
                      : current.roles,
                  }))
                }
              />
            </div>
          </div>
        </section>

        <section className="rounded-[26px] border border-white/10 bg-white/[0.02] p-5 sm:p-6">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <FieldLabel label="Details" icon={<MessageSquareText className="size-3.5" />} />
              <div>
                <h4 className="text-lg font-semibold text-white">Notes, broadcast flags and admin context</h4>
                <p className="text-sm leading-6 text-white/45">
                  Public-facing notes and internal annotations are grouped together like the final step of the public flow.
                </p>
              </div>
            </div>
            <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs uppercase tracking-[0.16em] text-white/40">
              Step 3
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <FieldLabel label="Public Notes" icon={<MessageSquareText className="size-3.5" />} />
              <Textarea
                className={ADMIN_TEXTAREA_CLASS}
                value={draft.notes}
                onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Visible notes for balancer-facing context"
              />
            </div>
            <div className="space-y-2">
              <FieldLabel label="Admin Notes" icon={<BadgeInfo className="size-3.5" />} />
              <Textarea
                className={ADMIN_TEXTAREA_CLASS}
                value={draft.admin_notes}
                onChange={(event) => setDraft((current) => ({ ...current, admin_notes: event.target.value }))}
                placeholder="Internal notes for admins only"
              />
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-[24px] border border-white/10 bg-black/20 p-4 sm:p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="max-w-md">
                  <FieldLabel label="Stream POV" icon={<RadioTower className="size-3.5" />} />
                  <h5 className="mt-2 text-base font-semibold text-white">Participant can stream</h5>
                  <p className="mt-1 text-sm leading-6 text-white/45">
                    Keeps the broadcast capability in the fixed admin details block instead of a separate control strip.
                  </p>
                </div>
                <Switch
                  checked={draft.stream_pov}
                  onCheckedChange={(checked) => setDraft((current) => ({ ...current, stream_pov: checked }))}
                />
              </div>
            </div>
            <div className="rounded-[24px] border border-dashed border-white/10 bg-black/20 p-4 sm:p-5">
              <FieldLabel label="Layout Rule" icon={<BadgeInfo className="size-3.5" />} />
              <h5 className="mt-2 text-base font-semibold text-white">Built-in admin fields stay fixed</h5>
              <p className="mt-1 text-sm leading-6 text-white/45">
                This editor keeps every built-in admin field in a predictable order. Custom fields are the only part expected to
                grow or collapse beyond this frame.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default function BalancerRegistrationsPage() {
  const tournamentId = useBalancerTournamentId();
  const divisionGrid = useDivisionGrid();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const searchParams = useSearchParams();

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<RegistrationStatusFilter>(
    (searchParams.get("status") as RegistrationStatusFilter | null) ?? "all",
  );
  const [inclusionFilter, setInclusionFilter] = useState<InclusionFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>(
    (searchParams.get("source") as SourceFilter | null) ?? "all",
  );
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [manualDraft, setManualDraft] = useState<ManualDraft>(EMPTY_MANUAL_DRAFT);
  const [editingRegistration, setEditingRegistration] = useState<AdminRegistration | null>(null);
  const [editingDraft, setEditingDraft] = useState<ManualDraft>(EMPTY_MANUAL_DRAFT);

  const registrationsQuery = useQuery({
    queryKey: ["balancer-admin", "registrations", tournamentId, statusFilter, inclusionFilter, sourceFilter],
    queryFn: () =>
      balancerAdminService.listRegistrations(tournamentId as number, {
        status_filter: statusFilter === "all" ? undefined : statusFilter,
        inclusion_filter: inclusionFilter === "all" ? undefined : inclusionFilter,
        source_filter: sourceFilter === "all" ? undefined : sourceFilter,
        include_deleted: false,
      }),
    enabled: tournamentId !== null,
  });

  const feedQuery = useQuery({
    queryKey: ["balancer-admin", "sheet", tournamentId],
    queryFn: () => balancerAdminService.getTournamentSheet(tournamentId as number),
    enabled: tournamentId !== null,
  });

  const invalidateRegistrations = async () => {
    await queryClient.invalidateQueries({ queryKey: ["balancer-admin", "registrations", tournamentId] });
  };

  const createMutation = useMutation({
    mutationFn: () =>
      balancerAdminService.createManualRegistration(tournamentId as number, {
        display_name: manualDraft.display_name || null,
        battle_tag: manualDraft.battle_tag || null,
        smurf_tags_json: normalizeSmurfTags(manualDraft.smurf_tags),
        discord_nick: manualDraft.discord_nick || null,
        twitch_nick: manualDraft.twitch_nick || null,
        notes: manualDraft.notes || null,
        admin_notes: manualDraft.admin_notes || null,
        is_flex: manualDraft.is_flex,
        stream_pov: manualDraft.stream_pov,
        roles: buildRolePayload(manualDraft.roles, manualDraft.is_flex),
      }),
    onSuccess: async () => {
      await invalidateRegistrations();
      setCreateOpen(false);
      setManualDraft(createEmptyManualDraft());
      toast({ title: "Manual registration created" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create registration", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: () => {
      if (!editingRegistration) {
        throw new Error("No registration selected");
      }
      return balancerAdminService.updateRegistration(editingRegistration.id, {
        display_name: editingDraft.display_name || null,
        battle_tag: editingDraft.battle_tag || null,
        smurf_tags_json: normalizeSmurfTags(editingDraft.smurf_tags),
        discord_nick: editingDraft.discord_nick || null,
        twitch_nick: editingDraft.twitch_nick || null,
        notes: editingDraft.notes || null,
        admin_notes: editingDraft.admin_notes || null,
        is_flex: editingDraft.is_flex,
        stream_pov: editingDraft.stream_pov,
        roles: buildRolePayload(editingDraft.roles, editingDraft.is_flex),
      });
    },
    onSuccess: async () => {
      await invalidateRegistrations();
      setEditingRegistration(null);
      setEditingDraft(createEmptyManualDraft());
      toast({ title: "Registration updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update registration", description: error.message, variant: "destructive" });
    },
  });

  const approveMutation = useMutation({
    mutationFn: (registrationId: number) => balancerAdminService.approveRegistration(registrationId),
    onSuccess: async () => {
      await invalidateRegistrations();
      toast({ title: "Registration approved" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to approve", description: error.message, variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (registrationId: number) => balancerAdminService.rejectRegistration(registrationId),
    onSuccess: async () => {
      await invalidateRegistrations();
      toast({ title: "Registration rejected" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to reject", description: error.message, variant: "destructive" });
    },
  });

  const withdrawMutation = useMutation({
    mutationFn: (registrationId: number) => balancerAdminService.withdrawRegistration(registrationId),
    onSuccess: async () => {
      await invalidateRegistrations();
      toast({ title: "Registration withdrawn" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to withdraw", description: error.message, variant: "destructive" });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (registrationId: number) => balancerAdminService.restoreRegistration(registrationId),
    onSuccess: async () => {
      await invalidateRegistrations();
      toast({ title: "Registration restored" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to restore", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (registrationId: number) => balancerAdminService.deleteRegistration(registrationId),
    onSuccess: async () => {
      await invalidateRegistrations();
      toast({ title: "Registration deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete", description: error.message, variant: "destructive" });
    },
  });

  const bulkApproveMutation = useMutation({
    mutationFn: () => balancerAdminService.bulkApproveRegistrations(tournamentId as number, Array.from(selectedIds)),
    onSuccess: async (result) => {
      await invalidateRegistrations();
      setSelectedIds(new Set());
      toast({ title: `${result.approved} approved, ${result.skipped} skipped` });
    },
    onError: (error: Error) => {
      toast({ title: "Bulk approve failed", description: error.message, variant: "destructive" });
    },
  });

  const balancerStatusMutation = useMutation({
    mutationFn: ({ registrationId, balancerStatus }: { registrationId: number; balancerStatus: "not_in_balancer" | "incomplete" | "ready" }) =>
      balancerAdminService.setBalancerStatus(registrationId, balancerStatus),
    onSuccess: async () => {
      await invalidateRegistrations();
      toast({ title: "Balancer status updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update balancer status", description: error.message, variant: "destructive" });
    },
  });

  const checkInMutation = useMutation({
    mutationFn: ({ registrationId, checkedIn }: { registrationId: number; checkedIn: boolean }) =>
      balancerAdminService.checkInRegistration(registrationId, checkedIn),
    onSuccess: async (_, variables) => {
      await invalidateRegistrations();
      toast({ title: variables.checkedIn ? "Checked in" : "Check-in removed" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update check-in", description: error.message, variant: "destructive" });
    },
  });

  const bulkAddToBalancerMutation = useMutation({
    mutationFn: () => balancerAdminService.bulkAddToBalancer(tournamentId as number, Array.from(selectedIds)),
    onSuccess: async (result) => {
      await invalidateRegistrations();
      setSelectedIds(new Set());
      toast({ title: `${result.updated} added to balancer, ${result.skipped} skipped` });
    },
    onError: (error: Error) => {
      toast({ title: "Bulk add to balancer failed", description: error.message, variant: "destructive" });
    },
  });

  const registrations = registrationsQuery.data ?? [];
  const filteredRegistrations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return registrations;
    }
    return registrations.filter((registration) =>
      [
        registration.display_name,
        registration.battle_tag,
        registration.discord_nick,
        registration.twitch_nick,
        registration.notes,
        registration.admin_notes,
        registration.source,
        registration.source_record_key,
        ...registration.roles.map((role) => role.role),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [registrations, searchQuery]);

  const pendingCount = registrations.filter((registration) => registration.status === "pending").length;
  const feedHref = searchParams.toString()
    ? `/balancer/registrations/feed?${searchParams.toString()}`
    : "/balancer/registrations/feed";

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
      <RegistrationToggleBar tournamentId={tournamentId} />
      <FeedSummaryCard feed={feedQuery.data} href={feedHref} />

      <Card className="flex min-h-0 flex-col overflow-hidden">
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Registrations</CardTitle>
              <CardDescription>
                {pendingCount > 0 ? `${pendingCount} pending. ` : null}
                Showing {filteredRegistrations.length} of {registrations.length}.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setCreateOpen(true)}>
                <UserPlus className="mr-2 h-4 w-4" />
                Create registration
              </Button>
              {selectedIds.size > 0 ? (
                <>
                  <Button onClick={() => bulkApproveMutation.mutate()} disabled={bulkApproveMutation.isPending}>
                    {bulkApproveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                    Approve {selectedIds.size}
                  </Button>
                  <Button variant="outline" onClick={() => bulkAddToBalancerMutation.mutate()} disabled={bulkAddToBalancerMutation.isPending}>
                    {bulkAddToBalancerMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                    Add to Balancer {selectedIds.size}
                  </Button>
                </>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="md:col-span-2">
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search registrations"
              />
            </div>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as RegistrationStatusFilter)}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="withdrawn">Withdrawn</SelectItem>
                <SelectItem value="banned">Banned</SelectItem>
                <SelectItem value="insufficient_data">Incomplete</SelectItem>
              </SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-3">
              <Select value={inclusionFilter} onValueChange={(value) => setInclusionFilter(value as InclusionFilter)}>
                <SelectTrigger><SelectValue placeholder="Participation" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All participation</SelectItem>
                  <SelectItem value="included">Included</SelectItem>
                  <SelectItem value="excluded">Excluded</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sourceFilter} onValueChange={(value) => setSourceFilter(value as SourceFilter)}>
                <SelectTrigger><SelectValue placeholder="Source" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sources</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="google_sheets">Google Sheets</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="min-h-0 flex-1 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Participant</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Balancer</TableHead>
                <TableHead>Check-in</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead className="w-[320px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRegistrations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                    No registrations match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                filteredRegistrations.map((registration) => {
                  const statusConfig = STATUS_CONFIG[registration.status];
                  const StatusIcon = statusConfig.icon;
                  const selectable = registration.status === "pending";
                  const inBalancer = registration.balancer_status === "ready";
                  return (
                    <TableRow key={registration.id}>
                        <TableCell>
                          {selectable ? (
                            <Checkbox
                              checked={selectedIds.has(registration.id)}
                              onCheckedChange={(checked) =>
                                setSelectedIds((current) => {
                                  const next = new Set(current);
                                  if (checked) {
                                    next.add(registration.id);
                                  } else {
                                    next.delete(registration.id);
                                  }
                                  return next;
                                })
                              }
                            />
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <div className="font-medium">{registration.battle_tag ?? registration.display_name ?? `Registration #${registration.id}`}</div>
                            <div className="text-xs text-muted-foreground">
                              {[registration.discord_nick, registration.twitch_nick].filter(Boolean).join(" · ") || registration.source_record_key || "-"}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell><SourceBadge source={registration.source} /></TableCell>
                        <TableCell><RolesCell roles={registration.roles} /></TableCell>
                        <TableCell>
                          <Badge variant="outline" className={statusConfig.className}>
                            <StatusIcon className="mr-1 h-3.5 w-3.5" />
                            {statusConfig.label}
                          </Badge>
                        </TableCell>
                        <TableCell><BalancerBadge registration={registration} /></TableCell>
                        <TableCell><CheckInBadge registration={registration} /></TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {registration.submitted_at ? new Date(registration.submitted_at).toLocaleString() : "-"}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            {registration.status === "pending" ? (
                              <>
                                <Button size="sm" variant="outline" onClick={() => approveMutation.mutate(registration.id)}>
                                  <Check className="mr-1.5 h-3.5 w-3.5" />
                                  Approve
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => rejectMutation.mutate(registration.id)}>
                                  <X className="mr-1.5 h-3.5 w-3.5" />
                                  Reject
                                </Button>
                              </>
                            ) : null}
                            {registration.status !== "withdrawn" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setEditingRegistration(registration);
                                  setEditingDraft(buildManualDraftFromRegistration(registration));
                                }}
                              >
                                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                                Edit
                              </Button>
                            ) : null}
                            {registration.status === "approved" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => balancerStatusMutation.mutate({
                                  registrationId: registration.id,
                                  balancerStatus: inBalancer ? "not_in_balancer" : "ready",
                                })}
                              >
                                {inBalancer ? <ShieldX className="mr-1.5 h-3.5 w-3.5" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
                                {inBalancer ? "Remove from Balancer" : "Add to Balancer"}
                              </Button>
                            ) : null}
                            {registration.status === "approved" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => checkInMutation.mutate({
                                  registrationId: registration.id,
                                  checkedIn: !registration.checked_in,
                                })}
                              >
                                <Check className="mr-1.5 h-3.5 w-3.5" />
                                {registration.checked_in ? "Uncheck-in" : "Check-in"}
                              </Button>
                            ) : null}
                            {registration.status === "withdrawn" ? (
                              <Button size="sm" variant="outline" onClick={() => restoreMutation.mutate(registration.id)}>
                                <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                                Restore
                              </Button>
                            ) : (
                              <Button size="sm" variant="outline" onClick={() => withdrawMutation.mutate(registration.id)}>
                                <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                                Withdraw
                              </Button>
                            )}
                            <Button size="sm" variant="outline" onClick={() => deleteMutation.mutate(registration.id)}>
                              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                              Delete
                            </Button>
                          </div>
                        </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) {
            setManualDraft(createEmptyManualDraft());
          }
        }}
      >
        <DialogContent className="max-w-5xl gap-0 overflow-hidden border-white/10 bg-[#06070c] p-0 text-white shadow-[0_30px_120px_rgba(0,0,0,0.55)] sm:rounded-[30px]">
          <DialogHeader className="border-b border-white/10 px-6 py-5 text-left sm:px-7">
            <DialogTitle className="text-2xl font-semibold tracking-tight text-white">Create Manual Registration</DialogTitle>
            <DialogDescription className="mt-2 max-w-3xl text-sm leading-6 text-white/50">
              Open the same multi-step visual shell used by the public flow, but keep every admin field available in one fixed editor.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[calc(100vh-16rem)] overflow-y-auto px-6 py-6 sm:px-7">
            <RegistrationProfileForm draft={manualDraft} setDraft={setManualDraft} divisionGrid={divisionGrid} />
          </div>
          <DialogFooter className="border-t border-white/10 px-6 py-5 sm:px-7">
            <Button
              variant="outline"
              className="border-white/10 bg-white/[0.03] text-white hover:bg-white/[0.06] hover:text-white"
              onClick={() => {
                setCreateOpen(false);
                setManualDraft(createEmptyManualDraft());
              }}
            >
              Cancel
            </Button>
            <Button
              className="min-w-[170px] bg-white text-black hover:bg-white/90"
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !manualDraft.battle_tag.trim()}
            >
              {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editingRegistration !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditingRegistration(null);
            setEditingDraft(createEmptyManualDraft());
          }
        }}
      >
        <DialogContent className="max-w-5xl gap-0 overflow-hidden border-white/10 bg-[#06070c] p-0 text-white shadow-[0_30px_120px_rgba(0,0,0,0.55)] sm:rounded-[30px]">
          <DialogHeader className="border-b border-white/10 px-6 py-5 text-left sm:px-7">
            <DialogTitle className="text-2xl font-semibold tracking-tight text-white">Edit Registration</DialogTitle>
            <DialogDescription className="mt-2 max-w-3xl text-sm leading-6 text-white/50">
              Update balancer-facing participant data in the fixed admin editor, while keeping the public multi-step look and hierarchy.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[calc(100vh-16rem)] overflow-y-auto px-6 py-6 sm:px-7">
            <RegistrationProfileForm draft={editingDraft} setDraft={setEditingDraft} divisionGrid={divisionGrid} />
          </div>
          <DialogFooter className="border-t border-white/10 px-6 py-5 sm:px-7">
            <Button
              variant="outline"
              className="border-white/10 bg-white/[0.03] text-white hover:bg-white/[0.06] hover:text-white"
              onClick={() => {
                setEditingRegistration(null);
                setEditingDraft(createEmptyManualDraft());
              }}
            >
              Cancel
            </Button>
            <Button
              className="min-w-[170px] bg-white text-black hover:bg-white/90"
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending || !editingDraft.battle_tag.trim()}
            >
              {updateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Pencil className="mr-2 h-4 w-4" />}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
