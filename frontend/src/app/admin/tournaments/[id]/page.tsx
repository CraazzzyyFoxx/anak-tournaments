"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleAlert,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  FolderInput,
  Hash,
  History,
  Layers3,
  Link2,
  ListChecks,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Trophy,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { EntityFormDialog } from "@/components/admin/EntityFormDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { hasUnsavedChanges } from "@/lib/form-change";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import adminService from "@/services/admin.service";
import balancerAdminService from "@/services/balancer-admin.service";
import encounterService from "@/services/encounter.service";
import teamService from "@/services/team.service";
import tournamentService from "@/services/tournament.service";
import type {
  ChallongeTournamentLookup,
  DiscordChannelInput,
  DiscordChannelRead,
  EncounterCreateInput,
  EncounterUpdateInput,
  LogProcessingRecord,
  StandingUpdateInput,
  TeamCreateInput,
  TeamUpdateInput,
  TournamentGroupCreateInput,
  TournamentGroupUpdateInput,
  TournamentUpdateInput,
} from "@/types/admin.types";
import type { Encounter } from "@/types/encounter.types";
import type { Team } from "@/types/team.types";
import type { Standings, Tournament, TournamentGroup } from "@/types/tournament.types";

function formatDate(value?: Date | string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString();
}

function toDateInput(value?: Date | string | null) {
  if (!value) return "";
  return new Date(value).toISOString().split("T")[0] ?? "";
}

function normalizeChallongeSlug(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    if (url.hostname.includes("challonge.com")) {
      const segments = url.pathname.split("/").filter(Boolean);
      return segments.at(-1) ?? trimmed;
    }
  } catch {
    // ignore malformed URL input and fall back to raw slug handling
  }

  return trimmed.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean).at(-1) ?? trimmed;
}

function getGroupTypeLabel(isGroups: boolean) {
  return isGroups ? "Group stage" : "Playoffs";
}

type TournamentFormState = {
  number: number | null;
  name: string;
  description: string;
  is_league: boolean;
  is_finished: boolean;
  start_date: string;
  end_date: string;
};

type GroupFormState = {
  name: string;
  description: string;
  is_groups: boolean;
  challongeLookup: string;
  challonge_id: number | null;
  challonge_slug: string | null;
};

type TeamFormState = {
  name: string;
  captain_id: number;
  avg_sr: number;
  total_sr: number;
};

type EncounterFormState = {
  name: string;
  tournament_group_id: number | null;
  home_team_id: number;
  away_team_id: number;
  round: number;
  home_score: number;
  away_score: number;
  status: string;
};

type StandingFormState = {
  position: number;
  points: number;
  win: number;
  draw: number;
  lose: number;
};

function getTournamentForm(tournament: Tournament): TournamentFormState {
  return {
    number: tournament.number ?? null,
    name: tournament.name,
    description: tournament.description ?? "",
    is_league: tournament.is_league,
    is_finished: tournament.is_finished,
    start_date: toDateInput(tournament.start_date),
    end_date: toDateInput(tournament.end_date),
  };
}

function getEmptyGroupForm(): GroupFormState {
  return {
    name: "",
    description: "",
    is_groups: true,
    challongeLookup: "",
    challonge_id: null,
    challonge_slug: null,
  };
}

function getGroupForm(group: TournamentGroup): GroupFormState {
  return {
    name: group.name,
    description: group.description ?? "",
    is_groups: group.is_groups,
    challongeLookup: group.challonge_slug ?? "",
    challonge_id: group.challonge_id,
    challonge_slug: group.challonge_slug,
  };
}

function getEmptyTeamForm(): TeamFormState {
  return {
    name: "",
    captain_id: 0,
    avg_sr: 0,
    total_sr: 0,
  };
}

function getTeamForm(team: Team): TeamFormState {
  return {
    name: team.name,
    captain_id: team.captain_id,
    avg_sr: team.avg_sr,
    total_sr: team.total_sr,
  };
}

function getEmptyEncounterForm(defaultGroupId: number | null): EncounterFormState {
  return {
    name: "",
    tournament_group_id: defaultGroupId,
    home_team_id: 0,
    away_team_id: 0,
    round: 1,
    home_score: 0,
    away_score: 0,
    status: "open",
  };
}

function getEncounterForm(encounter: Encounter): EncounterFormState {
  return {
    name: encounter.name,
    tournament_group_id: encounter.tournament_group_id ?? null,
    home_team_id: encounter.home_team_id,
    away_team_id: encounter.away_team_id,
    round: encounter.round,
    home_score: encounter.score.home,
    away_score: encounter.score.away,
    status: encounter.status,
  };
}

function getStandingForm(standing: Standings): StandingFormState {
  return {
    position: standing.position,
    points: standing.points,
    win: standing.win,
    draw: standing.draw,
    lose: standing.lose,
  };
}

const adminDetailTableShell = "overflow-hidden rounded-xl border border-border/60 bg-background/40";
const adminDetailTableHeaderRow = "border-border/60 hover:bg-transparent";
const adminDetailTableHead =
  "h-11 bg-muted/15 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/90 first:pl-4 last:pr-4";
const adminDetailTableRow = "border-border/50 transition-colors duration-200 hover:bg-muted/20";
const adminDetailTableCell = "py-3.5 first:pl-4 last:pr-4 align-top";

export default function AdminTournamentWorkspacePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const tournamentId = Number(params.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const importTeamsFileRef = useRef<HTMLInputElement>(null);

  const canUpdateTournament = hasPermission("tournament.update");
  const canDeleteTournament = hasPermission("tournament.delete");
  const canCreateTeam = hasPermission("team.create");
  const canUpdateTeam = hasPermission("team.update");
  const canDeleteTeam = hasPermission("team.delete");
  const canImportTeams = hasPermission("team.import");
  const canCreateEncounter = hasPermission("match.create");
  const canUpdateEncounter = hasPermission("match.update");
  const canDeleteEncounter = hasPermission("match.delete");
  const canSyncEncounters = hasPermission("match.sync");
  const canUpdateStanding = hasPermission("standing.update");
  const canDeleteStanding = hasPermission("standing.delete");
  const canRecalculateStandings = hasPermission("standing.recalculate");

  const tournamentQuery = useQuery({
    queryKey: ["admin", "tournament", tournamentId],
    queryFn: () => adminService.getTournament(tournamentId),
    enabled: Number.isFinite(tournamentId) && tournamentId > 0,
  });

  const teamsQuery = useQuery({
    queryKey: ["admin", "tournament", tournamentId, "teams"],
    queryFn: () => teamService.getAll(tournamentId),
    enabled: Number.isFinite(tournamentId) && tournamentId > 0,
  });

  const standingsQuery = useQuery({
    queryKey: ["admin", "tournament", tournamentId, "standings"],
    queryFn: () => tournamentService.getStandings(tournamentId),
    enabled: Number.isFinite(tournamentId) && tournamentId > 0,
  });

  const encountersQuery = useQuery({
    queryKey: ["admin", "tournament", tournamentId, "encounters"],
    queryFn: () => encounterService.getAll(1, "", tournamentId, -1),
    enabled: Number.isFinite(tournamentId) && tournamentId > 0,
  });

  const discordChannelQuery = useQuery({
    queryKey: ["admin", "tournament", tournamentId, "discord-channel"],
    queryFn: () => adminService.getDiscordChannel(tournamentId),
    enabled: Number.isFinite(tournamentId) && tournamentId > 0,
  });

  const logHistoryQuery = useQuery({
    queryKey: ["admin", "tournament", tournamentId, "log-history"],
    queryFn: () => adminService.getLogHistory(tournamentId, { limit: 50 }),
    enabled: Number.isFinite(tournamentId) && tournamentId > 0,
    refetchInterval: 10_000,
  });

  const invalidateWorkspace = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin", "tournament", tournamentId] }),
      queryClient.invalidateQueries({ queryKey: ["admin", "tournament", tournamentId, "teams"] }),
      queryClient.invalidateQueries({ queryKey: ["admin", "tournament", tournamentId, "standings"] }),
      queryClient.invalidateQueries({ queryKey: ["admin", "tournament", tournamentId, "encounters"] }),
      queryClient.invalidateQueries({ queryKey: ["tournaments"] }),
      queryClient.invalidateQueries({ queryKey: ["teams"] }),
      queryClient.invalidateQueries({ queryKey: ["encounters"] }),
      queryClient.invalidateQueries({ queryKey: ["standings"] }),
    ]);
  };

  const tournament = tournamentQuery.data;
  const groups = tournament?.groups ?? [];
  const teams = teamsQuery.data?.results ?? [];
  const standings = standingsQuery.data ?? [];
  const encounters = encountersQuery.data?.results ?? [];
  const defaultGroupId = groups[0]?.id ?? null;
  const linkedGroupCount = groups.filter((group) => Boolean(group.challonge_slug)).length;
  const manualGroupCount = groups.length - linkedGroupCount;
  const groupedTeamCount = teams.filter((team) => Boolean(team.group)).length;
  const completedEncounterCount = encounters.filter((encounter) => encounter.status === "completed").length;
  const hasChallongeSource = Boolean(tournament?.challonge_slug || linkedGroupCount > 0);
  const canCreateEncounterNow = canCreateEncounter && teams.length >= 2;
  const canManageStandingsNow = canRecalculateStandings && encounters.length > 0;
  const workspaceChecklist = [
    {
      label: "Groups ready",
      description: groups.length ? `${groups.length} configured` : "Create at least one group",
      done: groups.length > 0,
    },
    {
      label: "Teams ready",
      description: teams.length ? `${teams.length} teams loaded` : "Add or sync teams",
      done: teams.length > 0,
    },
    {
      label: "Encounters ready",
      description: encounters.length ? `${encounters.length} encounters tracked` : "Create encounters after teams",
      done: encounters.length > 0,
    },
    {
      label: "Standings ready",
      description: standings.length ? `${standings.length} standings rows present` : "Calculate after encounters exist",
      done: standings.length > 0,
    },
  ];

  const [tournamentDialogOpen, setTournamentDialogOpen] = useState(false);
  const [tournamentFormData, setTournamentFormData] = useState<TournamentFormState>({
    number: null,
    name: "",
    description: "",
    is_league: false,
    is_finished: false,
    start_date: "",
    end_date: "",
  });

  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<TournamentGroup | null>(null);
  const [groupFormData, setGroupFormData] = useState<GroupFormState>(getEmptyGroupForm());
  const [groupLookupPreview, setGroupLookupPreview] = useState<ChallongeTournamentLookup | null>(null);
  const [groupFormError, setGroupFormError] = useState<string | undefined>();
  const [groupPendingDelete, setGroupPendingDelete] = useState<TournamentGroup | null>(null);

  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [teamFormData, setTeamFormData] = useState<TeamFormState>(getEmptyTeamForm());
  const [teamFormError, setTeamFormError] = useState<string | undefined>();
  const [teamPendingDelete, setTeamPendingDelete] = useState<Team | null>(null);

  const [encounterDialogOpen, setEncounterDialogOpen] = useState(false);
  const [editingEncounter, setEditingEncounter] = useState<Encounter | null>(null);
  const [encounterFormData, setEncounterFormData] = useState<EncounterFormState>(
    getEmptyEncounterForm(defaultGroupId)
  );
  const [encounterFormError, setEncounterFormError] = useState<string | undefined>();
  const [encounterPendingDelete, setEncounterPendingDelete] = useState<Encounter | null>(null);

  const [editingStanding, setEditingStanding] = useState<Standings | null>(null);
  const [standingDialogOpen, setStandingDialogOpen] = useState(false);
  const [standingFormData, setStandingFormData] = useState<StandingFormState>({
    position: 0,
    points: 0,
    win: 0,
    draw: 0,
    lose: 0,
  });
  const [tournamentDeleteOpen, setTournamentDeleteOpen] = useState(false);
  const [standingPendingDelete, setStandingPendingDelete] = useState<Standings | null>(null);

  // Discord channel state
  const [discordChannelDialogOpen, setDiscordChannelDialogOpen] = useState(false);
  const [discordChannelForm, setDiscordChannelForm] = useState<DiscordChannelInput>({
    guild_id: 0,
    channel_id: 0,
    channel_name: "",
    is_active: true,
  });
  const [discordChannelDeleteOpen, setDiscordChannelDeleteOpen] = useState(false);

  const resetTournamentDialog = () => {
    setTournamentDialogOpen(false);
    if (tournament) {
      setTournamentFormData(getTournamentForm(tournament));
    }
  };

  const resetGroupDialog = () => {
    setGroupDialogOpen(false);
    setEditingGroup(null);
    setGroupFormData(getEmptyGroupForm());
    setGroupLookupPreview(null);
    setGroupFormError(undefined);
    lookupChallongeMutation.reset();
    saveGroupMutation.reset();
  };

  const resetTeamDialog = () => {
    setTeamDialogOpen(false);
    setEditingTeam(null);
    setTeamFormData(getEmptyTeamForm());
    setTeamFormError(undefined);
    saveTeamMutation.reset();
  };

  const resetEncounterDialog = () => {
    setEncounterDialogOpen(false);
    setEditingEncounter(null);
    setEncounterFormData(getEmptyEncounterForm(defaultGroupId));
    setEncounterFormError(undefined);
    saveEncounterMutation.reset();
  };

  const resetStandingDialog = () => {
    setStandingDialogOpen(false);
    setEditingStanding(null);
    setStandingFormData({ position: 0, points: 0, win: 0, draw: 0, lose: 0 });
    updateStandingMutation.reset();
  };

  const toggleFinishedMutation = useMutation({
    mutationFn: () => adminService.toggleTournamentFinished(tournamentId),
    onSuccess: async () => {
      await invalidateWorkspace();
      toast({ title: "Tournament status updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateTournamentMutation = useMutation({
    mutationFn: (data: TournamentUpdateInput) => adminService.updateTournament(tournamentId, data),
    onSuccess: async () => {
      await invalidateWorkspace();
      resetTournamentDialog();
      toast({ title: "Tournament updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteTournamentMutation = useMutation({
    mutationFn: () => adminService.deleteTournament(tournamentId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["tournaments"] });
      toast({ title: "Tournament deleted" });
      router.push("/admin/tournaments");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const lookupChallongeMutation = useMutation({
    mutationFn: (slug: string) => adminService.lookupChallongeTournament(slug),
    onSuccess: (data) => {
      setGroupLookupPreview(data);
      setGroupFormError(undefined);
      setGroupFormData((current) => ({
        ...current,
        challonge_id: data.id,
        challonge_slug: data.url,
        name: current.name.trim() ? current.name : data.name,
        description: current.description.trim() ? current.description : data.description || "",
      }));
      toast({ title: "Challonge tournament linked" });
    },
    onError: (error: Error) => {
      setGroupLookupPreview(null);
      setGroupFormError(error.message);
    },
  });

  const saveGroupMutation = useMutation({
    mutationFn: async ({
      mode,
      groupId,
      data,
    }: {
      mode: "create" | "update";
      groupId?: number;
      data: TournamentGroupCreateInput | TournamentGroupUpdateInput;
    }) => {
      if (mode === "create") {
        return adminService.addTournamentGroup(tournamentId, data as TournamentGroupCreateInput);
      }

      return adminService.updateTournamentGroup(
        tournamentId,
        groupId!,
        data as TournamentGroupUpdateInput
      );
    },
    onSuccess: async (_data, variables) => {
      await invalidateWorkspace();
      resetGroupDialog();
      toast({
        title: variables.mode === "create" ? "Group created" : "Group updated",
      });
    },
    onError: (error: Error) => {
      setGroupFormError(error.message);
    },
  });

  const deleteGroupMutation = useMutation({
    mutationFn: (groupId: number) => adminService.deleteTournamentGroup(tournamentId, groupId),
    onSuccess: async () => {
      await invalidateWorkspace();
      setGroupPendingDelete(null);
      toast({ title: "Group deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const saveTeamMutation = useMutation({
    mutationFn: async ({
      mode,
      teamId,
      data,
    }: {
      mode: "create" | "update";
      teamId?: number;
      data: TeamCreateInput | TeamUpdateInput;
    }) => {
      if (mode === "create") {
        return adminService.createTeam(data as TeamCreateInput);
      }

      return adminService.updateTeam(teamId!, data as TeamUpdateInput);
    },
    onSuccess: async (_data, variables) => {
      await invalidateWorkspace();
      resetTeamDialog();
      toast({ title: variables.mode === "create" ? "Team created" : "Team updated" });
    },
    onError: (error: Error) => {
      setTeamFormError(error.message);
    },
  });

  const deleteTeamMutation = useMutation({
    mutationFn: (teamId: number) => adminService.deleteTeam(teamId),
    onSuccess: async () => {
      await invalidateWorkspace();
      setTeamPendingDelete(null);
      toast({ title: "Team deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const syncTeamsMutation = useMutation({
    mutationFn: () => adminService.syncTeamsFromChallonge(tournamentId),
    onSuccess: async () => {
      await invalidateWorkspace();
      toast({ title: "Teams synced from Challonge" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const importTeamsMutation = useMutation({
    mutationFn: (file: File) => balancerAdminService.importTeamsFromJson(tournamentId, file),
    onSuccess: async (result) => {
      await invalidateWorkspace();
      toast({ title: "Teams imported", description: `${result.imported_teams} teams created.` });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to import teams", description: error.message, variant: "destructive" });
    },
  });

  const saveEncounterMutation = useMutation({
    mutationFn: async ({
      mode,
      encounterId,
      data,
    }: {
      mode: "create" | "update";
      encounterId?: number;
      data: EncounterCreateInput | EncounterUpdateInput;
    }) => {
      if (mode === "create") {
        return adminService.createEncounter(data as EncounterCreateInput);
      }

      return adminService.updateEncounter(encounterId!, data as EncounterUpdateInput);
    },
    onSuccess: async (_data, variables) => {
      await invalidateWorkspace();
      resetEncounterDialog();
      toast({
        title: variables.mode === "create" ? "Encounter created" : "Encounter updated",
      });
    },
    onError: (error: Error) => {
      setEncounterFormError(error.message);
    },
  });

  const deleteEncounterMutation = useMutation({
    mutationFn: (encounterId: number) => adminService.deleteEncounter(encounterId),
    onSuccess: async () => {
      await invalidateWorkspace();
      setEncounterPendingDelete(null);
      toast({ title: "Encounter deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const syncEncountersMutation = useMutation({
    mutationFn: () => adminService.syncEncountersFromChallonge(tournamentId),
    onSuccess: async () => {
      await invalidateWorkspace();
      toast({ title: "Encounters synced from Challonge" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateStandingMutation = useMutation({
    mutationFn: ({ standingId, data }: { standingId: number; data: StandingUpdateInput }) =>
      adminService.updateStanding(standingId, data),
    onSuccess: async () => {
      await invalidateWorkspace();
      resetStandingDialog();
      toast({ title: "Standing updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteStandingMutation = useMutation({
    mutationFn: (standingId: number) => adminService.deleteStanding(standingId),
    onSuccess: async () => {
      await invalidateWorkspace();
      setStandingPendingDelete(null);
      toast({ title: "Standing deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const calculateStandingsMutation = useMutation({
    mutationFn: () => adminService.calculateStandings(tournamentId),
    onSuccess: async () => {
      await invalidateWorkspace();
      toast({ title: "Standings calculated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const recalculateStandingsMutation = useMutation({
    mutationFn: async () => {
      await adminService.recalculateStandings(tournamentId);
      return adminService.calculateStandings(tournamentId);
    },
    onSuccess: async () => {
      await invalidateWorkspace();
      toast({ title: "Standings recalculated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const saveDiscordChannelMutation = useMutation({
    mutationFn: (data: DiscordChannelInput) => adminService.setDiscordChannel(tournamentId, data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "tournament", tournamentId, "discord-channel"] });
      setDiscordChannelDialogOpen(false);
      toast({ title: "Discord channel configured" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteDiscordChannelMutation = useMutation({
    mutationFn: () => adminService.deleteDiscordChannel(tournamentId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "tournament", tournamentId, "discord-channel"] });
      setDiscordChannelDeleteOpen(false);
      toast({ title: "Discord channel removed" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const openTournamentDialog = () => {
    if (!tournament) return;
    updateTournamentMutation.reset();
    setTournamentFormData(getTournamentForm(tournament));
    setTournamentDialogOpen(true);
  };

  const openCreateGroupDialog = () => {
    setGroupFormError(undefined);
    setGroupLookupPreview(null);
    setEditingGroup(null);
    setGroupFormData(getEmptyGroupForm());
    setGroupDialogOpen(true);
  };

  const openEditGroupDialog = (group: TournamentGroup) => {
    setGroupFormError(undefined);
    setGroupLookupPreview(null);
    setEditingGroup(group);
    setGroupFormData(getGroupForm(group));
    setGroupDialogOpen(true);
  };

  const openCreateTeamDialog = () => {
    setTeamFormError(undefined);
    setEditingTeam(null);
    setTeamFormData(getEmptyTeamForm());
    setTeamDialogOpen(true);
  };

  const openEditTeamDialog = (team: Team) => {
    setTeamFormError(undefined);
    setEditingTeam(team);
    setTeamFormData(getTeamForm(team));
    setTeamDialogOpen(true);
  };

  const openCreateEncounterDialog = () => {
    setEncounterFormError(undefined);
    setEditingEncounter(null);
    setEncounterFormData(getEmptyEncounterForm(defaultGroupId));
    setEncounterDialogOpen(true);
  };

  const openEditEncounterDialog = (encounter: Encounter) => {
    setEncounterFormError(undefined);
    setEditingEncounter(encounter);
    setEncounterFormData(getEncounterForm(encounter));
    setEncounterDialogOpen(true);
  };

  const openEditStandingDialog = (standing: Standings) => {
    updateStandingMutation.reset();
    setEditingStanding(standing);
    setStandingFormData(getStandingForm(standing));
    setStandingDialogOpen(true);
  };

  const handleResolveChallonge = () => {
    const slug = normalizeChallongeSlug(groupFormData.challongeLookup);
    if (!slug) {
      setGroupFormError("Enter a Challonge slug or URL first.");
      return;
    }

    setGroupFormError(undefined);
    setGroupFormData((current) => ({ ...current, challongeLookup: slug }));
    lookupChallongeMutation.mutate(slug);
  };

  const handleTournamentSubmit = (event: FormEvent) => {
    event.preventDefault();

    const payload: TournamentUpdateInput = {
      number: tournamentFormData.number,
      name: tournamentFormData.name.trim(),
      description: tournamentFormData.description.trim() || null,
      is_league: tournamentFormData.is_league,
      is_finished: tournamentFormData.is_finished,
      start_date: tournamentFormData.start_date,
      end_date: tournamentFormData.end_date,
    };

    updateTournamentMutation.mutate(payload);
  };

  const handleGroupSubmit = (event: FormEvent) => {
    event.preventDefault();

    if (!groupFormData.name.trim()) {
      setGroupFormError("Group name is required.");
      return;
    }

    if (groupFormData.challongeLookup.trim() && !groupFormData.challonge_id) {
      setGroupFormError("Resolve the Challonge slug before saving the group.");
      return;
    }

    const payload: TournamentGroupCreateInput | TournamentGroupUpdateInput = {
      name: groupFormData.name.trim(),
      description: groupFormData.description.trim() || null,
      is_groups: groupFormData.is_groups,
      challonge_id: groupFormData.challonge_id,
      challonge_slug: groupFormData.challonge_slug,
    };

    saveGroupMutation.mutate(
      editingGroup
        ? { mode: "update", groupId: editingGroup.id, data: payload }
        : { mode: "create", data: payload }
    );
  };

  const handleTeamSubmit = (event: FormEvent) => {
    event.preventDefault();

    if (!teamFormData.name.trim()) {
      setTeamFormError("Team name is required.");
      return;
    }

    if (teamFormData.captain_id <= 0) {
      setTeamFormError("Captain user ID is required.");
      return;
    }

    const payload = editingTeam
      ? ({
          name: teamFormData.name.trim(),
          captain_id: teamFormData.captain_id,
          avg_sr: teamFormData.avg_sr,
          total_sr: teamFormData.total_sr,
        } satisfies TeamUpdateInput)
      : ({
          name: teamFormData.name.trim(),
          tournament_id: tournamentId,
          captain_id: teamFormData.captain_id,
          avg_sr: teamFormData.avg_sr,
          total_sr: teamFormData.total_sr,
        } satisfies TeamCreateInput);

    saveTeamMutation.mutate(
      editingTeam
        ? { mode: "update", teamId: editingTeam.id, data: payload }
        : { mode: "create", data: payload }
    );
  };

  const handleEncounterSubmit = (event: FormEvent) => {
    event.preventDefault();

    if (!encounterFormData.name.trim()) {
      setEncounterFormError("Encounter name is required.");
      return;
    }

    if (encounterFormData.home_team_id <= 0 || encounterFormData.away_team_id <= 0) {
      setEncounterFormError("Select both teams before saving the encounter.");
      return;
    }

    if (encounterFormData.home_team_id === encounterFormData.away_team_id) {
      setEncounterFormError("Home and away teams must be different.");
      return;
    }

    const payload = editingEncounter
      ? ({
          name: encounterFormData.name.trim(),
          tournament_group_id: encounterFormData.tournament_group_id,
          home_team_id: encounterFormData.home_team_id,
          away_team_id: encounterFormData.away_team_id,
          round: encounterFormData.round,
          home_score: encounterFormData.home_score,
          away_score: encounterFormData.away_score,
          status: encounterFormData.status,
        } satisfies EncounterUpdateInput)
      : ({
          name: encounterFormData.name.trim(),
          tournament_id: tournamentId,
          tournament_group_id: encounterFormData.tournament_group_id,
          home_team_id: encounterFormData.home_team_id,
          away_team_id: encounterFormData.away_team_id,
          round: encounterFormData.round,
          home_score: encounterFormData.home_score,
          away_score: encounterFormData.away_score,
          status: encounterFormData.status,
        } satisfies EncounterCreateInput);

    saveEncounterMutation.mutate(
      editingEncounter
        ? { mode: "update", encounterId: editingEncounter.id, data: payload }
        : { mode: "create", data: payload }
    );
  };

  const handleStandingSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!editingStanding) return;

    const payload: StandingUpdateInput = {
      position: standingFormData.position,
      points: standingFormData.points,
      win: standingFormData.win,
      draw: standingFormData.draw,
      lose: standingFormData.lose,
    };

    updateStandingMutation.mutate({ standingId: editingStanding.id, data: payload });
  };

  const tournamentFormInitial = tournament ? getTournamentForm(tournament) : tournamentFormData;
  const groupFormInitial = editingGroup ? getGroupForm(editingGroup) : getEmptyGroupForm();
  const teamFormInitial = editingTeam ? getTeamForm(editingTeam) : getEmptyTeamForm();
  const encounterFormInitial = editingEncounter
    ? getEncounterForm(editingEncounter)
    : getEmptyEncounterForm(defaultGroupId);
  const standingFormInitial = editingStanding
    ? getStandingForm(editingStanding)
    : { position: 0, points: 0, win: 0, draw: 0, lose: 0 };

  const isTournamentDirty = tournamentDialogOpen && hasUnsavedChanges(tournamentFormData, tournamentFormInitial);
  const isGroupDirty = groupDialogOpen && hasUnsavedChanges(groupFormData, groupFormInitial);
  const isTeamDirty = teamDialogOpen && hasUnsavedChanges(teamFormData, teamFormInitial);
  const isEncounterDirty =
    encounterDialogOpen && hasUnsavedChanges(encounterFormData, encounterFormInitial);
  const isStandingDirty =
    standingDialogOpen && hasUnsavedChanges(standingFormData, standingFormInitial);

  if (
    tournamentQuery.isLoading ||
    teamsQuery.isLoading ||
    standingsQuery.isLoading ||
    encountersQuery.isLoading
  ) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-28 w-full rounded-xl" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
        </div>
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    );
  }

  const queryError =
    tournamentQuery.error ?? teamsQuery.error ?? standingsQuery.error ?? encountersQuery.error;

  if (queryError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Workspace unavailable</CardTitle>
          <CardDescription>{(queryError as Error).message}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!tournament) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Tournament not found</CardTitle>
          <CardDescription>The requested admin workspace could not be loaded.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={tournament.name}
        description="Manage tournament settings, groups, teams, encounters, and standings in one workspace."
        eyebrow="Tournament Workspace"
        meta={
          <Badge variant={tournament.is_finished ? "outline" : "secondary"}>
            {tournament.is_finished ? "Finished" : "Live ops"}
          </Badge>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/admin/tournaments">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Tournaments
              </Link>
            </Button>
            {canUpdateTournament ? (
              <Button variant="outline" onClick={openTournamentDialog}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit Tournament
              </Button>
            ) : null}
            {canUpdateTournament ? (
              <Button
                onClick={() => toggleFinishedMutation.mutate()}
                disabled={toggleFinishedMutation.isPending}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                {tournament.is_finished ? "Reopen Tournament" : "Mark as Finished"}
              </Button>
            ) : null}
            {canDeleteTournament ? (
              <Button
                variant="destructive"
                onClick={() => setTournamentDeleteOpen(true)}
                disabled={deleteTournamentMutation.isPending}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Tournament
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Status</CardDescription>
            <CardTitle className="flex items-center gap-2 text-xl">
              <ShieldAlert className="h-5 w-5 text-muted-foreground" />
              {tournament.is_finished ? "Finished" : "Active"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={tournament.is_league ? "outline" : "default"}>
              {tournament.is_league ? "League" : "Tournament"}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Date Window</CardDescription>
            <CardTitle className="flex items-center gap-2 text-xl">
              <CalendarDays className="h-5 w-5 text-muted-foreground" />
              {formatDate(tournament.start_date)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Ends {formatDate(tournament.end_date)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Participants</CardDescription>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Users className="h-5 w-5 text-muted-foreground" />
              {tournament.participants_count ?? teams.length}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {teams.length} teams loaded in this workspace
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Groups</CardDescription>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Layers3 className="h-5 w-5 text-muted-foreground" />
              {groups.length}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {encounters.length} encounters and {standings.length} standings rows tracked
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/70 bg-gradient-to-r from-background to-muted/20">
        <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="h-4 w-4 text-muted-foreground" />
              Setup Checklist
            </CardTitle>
            <CardDescription>
              Use this sequence to go from empty tournament shell to a fully operable workspace.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={hasChallongeSource ? "secondary" : "outline"}>
              <Link2 className="mr-1 h-3 w-3" />
              {hasChallongeSource ? "Challonge linked" : "No Challonge link"}
            </Badge>
            <Badge variant={completedEncounterCount > 0 ? "secondary" : "outline"}>
              {completedEncounterCount} completed encounters
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {workspaceChecklist.map((item) => (
              <div
                key={item.label}
                className="rounded-xl border border-border/60 bg-background/70 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">{item.label}</p>
                  <Badge variant={item.done ? "secondary" : "outline"}>
                    {item.done ? "Done" : "Pending"}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{item.description}</p>
              </div>
            ))}
          </div>
          {!hasChallongeSource ? (
            <Alert className="border-dashed border-border/70 bg-background/60">
              <CircleAlert className="h-4 w-4" />
              <AlertTitle>Sync helpers need a link source</AlertTitle>
              <AlertDescription>
                Add a Challonge slug to the tournament or link at least one group to enable sync buttons for imported data.
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <CardTitle>Groups</CardTitle>
            <CardDescription>
              Create groups manually, link them to Challonge, edit metadata, or remove them.
            </CardDescription>
            <div className="flex flex-wrap gap-2 pt-1">
              <Badge variant="outline">{groups.length} total</Badge>
              <Badge variant="outline">{linkedGroupCount} linked</Badge>
              <Badge variant="outline">{manualGroupCount} manual</Badge>
            </div>
          </div>
          {canUpdateTournament ? (
            <Button onClick={openCreateGroupDialog}>
              <Plus className="mr-2 h-4 w-4" />
              Add Group
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          <div className={adminDetailTableShell}>
            <Table>
              <TableHeader>
                <TableRow className={adminDetailTableHeaderRow}>
                  <TableHead className={adminDetailTableHead}>Group</TableHead>
                  <TableHead className={adminDetailTableHead}>Type</TableHead>
                  <TableHead className={adminDetailTableHead}>Challonge</TableHead>
                  <TableHead className={adminDetailTableHead}>Description</TableHead>
                  <TableHead className={adminDetailTableHead}>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.length ? (
                  groups.map((group) => (
                    <TableRow key={group.id} className={adminDetailTableRow}>
                      <TableCell className={`${adminDetailTableCell} font-medium`}>
                        {group.name}
                      </TableCell>
                      <TableCell className={adminDetailTableCell}>
                        <Badge variant={group.is_groups ? "secondary" : "outline"}>
                          {getGroupTypeLabel(group.is_groups)}
                        </Badge>
                      </TableCell>
                      <TableCell className={adminDetailTableCell}>
                        {group.challonge_slug ? (
                          <Link
                            className="text-sm font-medium text-primary hover:underline"
                            href={`https://challonge.com/${group.challonge_slug}`}
                            target="_blank"
                          >
                            {group.challonge_slug}
                          </Link>
                        ) : (
                          <span className="text-sm text-muted-foreground">Manual only</span>
                        )}
                      </TableCell>
                      <TableCell className={adminDetailTableCell}>
                        <span className="text-sm text-muted-foreground">
                          {group.description || "-"}
                        </span>
                      </TableCell>
                      <TableCell className={adminDetailTableCell}>
                        <div className="flex items-center gap-2">
                          {canUpdateTournament ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Edit ${group.name}`}
                              onClick={() => openEditGroupDialog(group)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          ) : null}
                          {canUpdateTournament ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Delete ${group.name}`}
                              className="text-destructive"
                              onClick={() => setGroupPendingDelete(group)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow className={adminDetailTableRow}>
                    <TableCell className={adminDetailTableCell} colSpan={5}>
                      <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
                        <span>No groups configured yet. Start by creating a manual group or linking one from Challonge.</span>
                        {canUpdateTournament ? (
                          <Button variant="outline" onClick={openCreateGroupDialog}>
                            <Plus className="mr-2 h-4 w-4" />
                            Add First Group
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <CardTitle>Teams</CardTitle>
            <CardDescription>
              Add teams manually, edit seeded stats, delete teams, or sync them from linked Challonge data.
            </CardDescription>
            <div className="flex flex-wrap gap-2 pt-1">
              <Badge variant="outline">{teams.length} teams</Badge>
              <Badge variant="outline">{groupedTeamCount} assigned to groups</Badge>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canImportTeams ? (
              <Button
                variant="outline"
                onClick={() => syncTeamsMutation.mutate()}
                disabled={syncTeamsMutation.isPending || !hasChallongeSource}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Sync Teams
              </Button>
            ) : null}
            {canImportTeams ? (
              <>
                <input
                  ref={importTeamsFileRef}
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) importTeamsMutation.mutate(file);
                    e.target.value = "";
                  }}
                />
                <Button
                  variant="outline"
                  onClick={() => importTeamsFileRef.current?.click()}
                  disabled={importTeamsMutation.isPending}
                >
                  {importTeamsMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FolderInput className="mr-2 h-4 w-4" />
                  )}
                  Import from JSON
                </Button>
              </>
            ) : null}
            {canCreateTeam ? (
              <Button onClick={openCreateTeamDialog}>
                <Plus className="mr-2 h-4 w-4" />
                Create Team
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          <div className={adminDetailTableShell}>
            <Table>
              <TableHeader>
                <TableRow className={adminDetailTableHeaderRow}>
                  <TableHead className={adminDetailTableHead}>Team</TableHead>
                  <TableHead className={adminDetailTableHead}>Group</TableHead>
                  <TableHead className={adminDetailTableHead}>Avg SR</TableHead>
                  <TableHead className={adminDetailTableHead}>Total SR</TableHead>
                  <TableHead className={adminDetailTableHead}>Players</TableHead>
                  <TableHead className={adminDetailTableHead}>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {teams.length ? (
                  teams.map((team) => (
                    <TableRow key={team.id} className={adminDetailTableRow}>
                      <TableCell className={adminDetailTableCell}>
                        <span className="font-medium">{team.name}</span>
                      </TableCell>
                      <TableCell className={adminDetailTableCell}>
                        {team.group ? team.group.name : "-"}
                      </TableCell>
                      <TableCell className={adminDetailTableCell}>{team.avg_sr.toFixed(0)}</TableCell>
                      <TableCell className={adminDetailTableCell}>{team.total_sr}</TableCell>
                      <TableCell className={adminDetailTableCell}>{team.players.length}</TableCell>
                      <TableCell className={adminDetailTableCell}>
                        <div className="flex items-center gap-2">
                          {canUpdateTeam ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Edit ${team.name}`}
                              onClick={() => openEditTeamDialog(team)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          ) : null}
                          {canDeleteTeam ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive"
                              aria-label={`Delete ${team.name}`}
                              onClick={() => setTeamPendingDelete(team)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow className={adminDetailTableRow}>
                    <TableCell className={adminDetailTableCell} colSpan={6}>
                      <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
                        <span>No teams loaded for this tournament yet. Create one manually or sync from Challonge if the workspace is linked.</span>
                        <div className="flex flex-wrap gap-2">
                          {canImportTeams ? (
                            <Button
                              variant="outline"
                              onClick={() => syncTeamsMutation.mutate()}
                              disabled={syncTeamsMutation.isPending || !hasChallongeSource}
                            >
                              <RefreshCw className="mr-2 h-4 w-4" />
                              Sync Teams
                            </Button>
                          ) : null}
                          {canCreateTeam ? (
                            <Button variant="outline" onClick={openCreateTeamDialog}>
                              <Plus className="mr-2 h-4 w-4" />
                              Create First Team
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <CardTitle>Standings</CardTitle>
            <CardDescription>
              Edit or remove standings rows, then calculate or recalculate standings from encounter data.
            </CardDescription>
            <div className="flex flex-wrap gap-2 pt-1">
              <Badge variant="outline">{standings.length} rows</Badge>
              <Badge variant="outline">{completedEncounterCount} completed encounters</Badge>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canRecalculateStandings && standings.length === 0 ? (
              <Button
                variant="outline"
                onClick={() => calculateStandingsMutation.mutate()}
                disabled={calculateStandingsMutation.isPending || !canManageStandingsNow}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Calculate Standings
              </Button>
            ) : null}
            {canRecalculateStandings && standings.length > 0 ? (
              <Button
                variant="outline"
                onClick={() => recalculateStandingsMutation.mutate()}
                disabled={recalculateStandingsMutation.isPending || !canManageStandingsNow}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Recalculate Standings
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          <div className={adminDetailTableShell}>
            <Table>
              <TableHeader>
                <TableRow className={adminDetailTableHeaderRow}>
                  <TableHead className={adminDetailTableHead}>Pos</TableHead>
                  <TableHead className={adminDetailTableHead}>Team</TableHead>
                  <TableHead className={adminDetailTableHead}>Group</TableHead>
                  <TableHead className={adminDetailTableHead}>Points</TableHead>
                  <TableHead className={adminDetailTableHead}>Record</TableHead>
                  <TableHead className={adminDetailTableHead}>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {standings.length ? (
                  standings.map((standing) => (
                    <TableRow key={standing.id} className={adminDetailTableRow}>
                      <TableCell className={adminDetailTableCell}>
                        <div className="flex items-center gap-2 font-semibold">
                          {standing.position === 1 ? (
                            <Trophy className="h-4 w-4 text-yellow-500" />
                          ) : null}
                          {standing.position}
                        </div>
                      </TableCell>
                      <TableCell className={`${adminDetailTableCell} font-medium`}>
                        {standing.team?.name ?? "-"}
                      </TableCell>
                      <TableCell className={adminDetailTableCell}>{standing.group?.name ?? "-"}</TableCell>
                      <TableCell className={adminDetailTableCell}>{standing.points}</TableCell>
                      <TableCell className={adminDetailTableCell}>
                        {standing.win}-{standing.draw}-{standing.lose}
                      </TableCell>
                      <TableCell className={adminDetailTableCell}>
                        <div className="flex items-center gap-2">
                          {canUpdateStanding ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Edit standing for ${standing.team?.name ?? "team"}`}
                              onClick={() => openEditStandingDialog(standing)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          ) : null}
                          {canDeleteStanding ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive"
                              aria-label={`Delete standing for ${standing.team?.name ?? "team"}`}
                              onClick={() => setStandingPendingDelete(standing)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow className={adminDetailTableRow}>
                    <TableCell className={adminDetailTableCell} colSpan={6}>
                      <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
                        <span>No standings available yet. Complete at least one encounter, then calculate standings.</span>
                        {canRecalculateStandings ? (
                          <Button
                            variant="outline"
                            onClick={() => calculateStandingsMutation.mutate()}
                            disabled={calculateStandingsMutation.isPending || !canManageStandingsNow}
                          >
                            <RefreshCw className="mr-2 h-4 w-4" />
                            Calculate Standings
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <CardTitle>Encounters</CardTitle>
            <CardDescription>
              Create encounters manually, edit scores and status, or sync encounters from linked Challonge groups.
            </CardDescription>
            <div className="flex flex-wrap gap-2 pt-1">
              <Badge variant="outline">{encounters.length} encounters</Badge>
              <Badge variant="outline">{completedEncounterCount} completed</Badge>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canSyncEncounters ? (
              <Button
                variant="outline"
                onClick={() => syncEncountersMutation.mutate()}
                disabled={syncEncountersMutation.isPending || !hasChallongeSource}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Sync Encounters
              </Button>
            ) : null}
            {canCreateEncounter ? (
              <Button onClick={openCreateEncounterDialog} disabled={!canCreateEncounterNow}>
                <Plus className="mr-2 h-4 w-4" />
                Create Encounter
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          <div className={adminDetailTableShell}>
            <Table>
              <TableHeader>
                <TableRow className={adminDetailTableHeaderRow}>
                  <TableHead className={adminDetailTableHead}>Encounter</TableHead>
                  <TableHead className={adminDetailTableHead}>Group</TableHead>
                  <TableHead className={adminDetailTableHead}>Round</TableHead>
                  <TableHead className={adminDetailTableHead}>Score</TableHead>
                  <TableHead className={adminDetailTableHead}>Status</TableHead>
                  <TableHead className={adminDetailTableHead}>Logs</TableHead>
                  <TableHead className={adminDetailTableHead}>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {encounters.length ? (
                  encounters.map((encounter) => (
                    <TableRow key={encounter.id} className={adminDetailTableRow}>
                      <TableCell className={adminDetailTableCell}>
                        <div className="space-y-1">
                          <span className="font-medium">{encounter.name}</span>
                          <p className="text-sm text-muted-foreground">
                            {encounter.home_team?.name ?? "TBD"} vs {encounter.away_team?.name ?? "TBD"}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className={adminDetailTableCell}>
                        {encounter.tournament_group?.name ?? "-"}
                      </TableCell>
                      <TableCell className={adminDetailTableCell}>{encounter.round}</TableCell>
                      <TableCell className={adminDetailTableCell}>
                        {encounter.score.home} - {encounter.score.away}
                      </TableCell>
                      <TableCell className={adminDetailTableCell}>
                        <Badge variant={encounter.status === "completed" ? "default" : "outline"}>
                          {encounter.status}
                        </Badge>
                      </TableCell>
                      <TableCell className={adminDetailTableCell}>
                        {encounter.has_logs ? (
                          <Badge variant="default">Available</Badge>
                        ) : (
                          <Badge variant="outline">Missing</Badge>
                        )}
                      </TableCell>
                      <TableCell className={adminDetailTableCell}>
                        <div className="flex items-center gap-2">
                          {canUpdateEncounter ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Edit ${encounter.name}`}
                              onClick={() => openEditEncounterDialog(encounter)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          ) : null}
                          {canDeleteEncounter ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive"
                              aria-label={`Delete ${encounter.name}`}
                              onClick={() => setEncounterPendingDelete(encounter)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow className={adminDetailTableRow}>
                    <TableCell className={adminDetailTableCell} colSpan={7}>
                      <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
                        <span>
                          No encounters available yet. Add at least two teams before creating the first encounter.
                        </span>
                        <div className="flex flex-wrap gap-2">
                          {canSyncEncounters ? (
                            <Button
                              variant="outline"
                              onClick={() => syncEncountersMutation.mutate()}
                              disabled={syncEncountersMutation.isPending || !hasChallongeSource}
                            >
                              <RefreshCw className="mr-2 h-4 w-4" />
                              Sync Encounters
                            </Button>
                          ) : null}
                          {canCreateEncounter ? (
                            <Button
                              variant="outline"
                              onClick={openCreateEncounterDialog}
                              disabled={!canCreateEncounterNow}
                            >
                              <Plus className="mr-2 h-4 w-4" />
                              Create First Encounter
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ── Discord Sync Channel ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              Discord Sync Channel
            </CardTitle>
            <CardDescription>
              Discord channel where match logs are automatically collected.
            </CardDescription>
          </div>
          {canUpdateTournament && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const ch = discordChannelQuery.data;
                  setDiscordChannelForm({
                    guild_id: ch?.guild_id ?? 0,
                    channel_id: ch?.channel_id ?? 0,
                    channel_name: ch?.channel_name ?? "",
                    is_active: ch?.is_active ?? true,
                  });
                  setDiscordChannelDialogOpen(true);
                }}
              >
                <Pencil className="mr-2 h-4 w-4" />
                {discordChannelQuery.data ? "Edit" : "Configure"}
              </Button>
              {discordChannelQuery.data && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setDiscordChannelDeleteOpen(true)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Remove
                </Button>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {discordChannelQuery.isLoading ? (
            <Skeleton className="h-12 w-full" />
          ) : discordChannelQuery.data ? (
            <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Guild ID</p>
                <p className="font-mono">{discordChannelQuery.data.guild_id}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Channel ID</p>
                <p className="font-mono">{discordChannelQuery.data.channel_id}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Channel Name</p>
                <p>{discordChannelQuery.data.channel_name ?? "—"}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</p>
                <Badge variant={discordChannelQuery.data.is_active ? "default" : "secondary"}>
                  {discordChannelQuery.data.is_active ? "Active" : "Inactive"}
                </Badge>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No Discord sync channel configured for this tournament.</p>
          )}
        </CardContent>
      </Card>

      {/* ── Log Processing History ───────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <History className="h-4 w-4 text-muted-foreground" />
              Log Processing History
            </CardTitle>
            <CardDescription>
              Recent match log uploads and processing results. Refreshes every 10 seconds.
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => logHistoryQuery.refetch()} disabled={logHistoryQuery.isFetching}>
            <RefreshCw className={`h-4 w-4 ${logHistoryQuery.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {logHistoryQuery.isLoading ? (
            <div className="p-4 space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : !logHistoryQuery.data?.items.length ? (
            <p className="p-4 text-sm text-muted-foreground">No log processing records yet.</p>
          ) : (
            <div className={adminDetailTableShell}>
              <Table>
                <TableHeader>
                  <TableRow className={adminDetailTableHeaderRow}>
                    <TableHead className={adminDetailTableHead}>Filename</TableHead>
                    <TableHead className={adminDetailTableHead}>Status</TableHead>
                    <TableHead className={adminDetailTableHead}>Source</TableHead>
                    <TableHead className={adminDetailTableHead}>Uploader</TableHead>
                    <TableHead className={adminDetailTableHead}>Uploaded</TableHead>
                    <TableHead className={adminDetailTableHead}>Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logHistoryQuery.data.items.map((record) => {
                    const duration =
                      record.started_at && record.finished_at
                        ? `${((new Date(record.finished_at).getTime() - new Date(record.started_at).getTime()) / 1000).toFixed(1)}s`
                        : record.status === "processing"
                        ? "In progress…"
                        : "—";
                    const statusColors: Record<string, string> = {
                      pending: "secondary",
                      processing: "default",
                      done: "outline",
                      failed: "destructive",
                    };
                    return (
                      <TableRow key={record.id} className={adminDetailTableRow}>
                        <TableCell className={adminDetailTableCell}>
                          <span className="font-mono text-xs">{record.filename.split("/").at(-1)}</span>
                          {record.error_message && (
                            <p className="mt-1 text-xs text-destructive line-clamp-1">{record.error_message}</p>
                          )}
                        </TableCell>
                        <TableCell className={adminDetailTableCell}>
                          <Badge variant={(statusColors[record.status] as any) ?? "secondary"}>
                            {record.status}
                          </Badge>
                        </TableCell>
                        <TableCell className={adminDetailTableCell}>
                          <span className="capitalize text-muted-foreground text-sm">{record.source}</span>
                        </TableCell>
                        <TableCell className={adminDetailTableCell}>
                          {record.uploader_username ? (
                            <span className="text-sm">{record.uploader_username}</span>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>
                        <TableCell className={adminDetailTableCell}>
                          <span className="text-sm">{new Date(record.created_at).toLocaleString()}</span>
                        </TableCell>
                        <TableCell className={adminDetailTableCell}>
                          <span className="text-sm text-muted-foreground">{duration}</span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Discord channel configure dialog ────────────────────────────────── */}
      <EntityFormDialog
        open={discordChannelDialogOpen}
        onOpenChange={(open) => {
          setDiscordChannelDialogOpen(open);
          if (!open) saveDiscordChannelMutation.reset();
        }}
        title="Configure Discord Sync Channel"
        description="Set the Discord guild and channel from which match logs are automatically imported."
        onSubmit={(e) => {
          e.preventDefault();
          saveDiscordChannelMutation.mutate(discordChannelForm);
        }}
        isSubmitting={saveDiscordChannelMutation.isPending}
        submittingLabel="Saving..."
        errorMessage={saveDiscordChannelMutation.isError ? saveDiscordChannelMutation.error.message : undefined}
        isDirty={true}
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="discord-guild-id">Guild ID</Label>
            <Input
              id="discord-guild-id"
              type="number"
              value={discordChannelForm.guild_id || ""}
              onChange={(e) => setDiscordChannelForm((c) => ({ ...c, guild_id: Number(e.target.value) }))}
              placeholder="e.g. 123456789012345678"
            />
          </div>
          <div>
            <Label htmlFor="discord-channel-id">Channel ID</Label>
            <Input
              id="discord-channel-id"
              type="number"
              value={discordChannelForm.channel_id || ""}
              onChange={(e) => setDiscordChannelForm((c) => ({ ...c, channel_id: Number(e.target.value) }))}
              placeholder="e.g. 987654321098765432"
            />
          </div>
          <div>
            <Label htmlFor="discord-channel-name">Channel Name (optional)</Label>
            <Input
              id="discord-channel-name"
              value={discordChannelForm.channel_name ?? ""}
              onChange={(e) => setDiscordChannelForm((c) => ({ ...c, channel_name: e.target.value || null }))}
              placeholder="e.g. #match-logs"
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="discord-is-active"
              checked={discordChannelForm.is_active}
              onCheckedChange={(checked) => setDiscordChannelForm((c) => ({ ...c, is_active: Boolean(checked) }))}
            />
            <Label htmlFor="discord-is-active">Active (bot will monitor this channel)</Label>
          </div>
        </div>
      </EntityFormDialog>

      <DeleteConfirmDialog
        open={discordChannelDeleteOpen}
        onOpenChange={setDiscordChannelDeleteOpen}
        onConfirm={() => deleteDiscordChannelMutation.mutate()}
        title="Remove Discord Channel"
        description="Remove the Discord sync channel configuration for this tournament? The bot will stop monitoring this channel."
        isDeleting={deleteDiscordChannelMutation.isPending}
      />

      <EntityFormDialog
        open={tournamentDialogOpen}
        onOpenChange={(open) => {
          setTournamentDialogOpen(open);
          if (!open) {
            resetTournamentDialog();
          }
        }}
        title="Edit Tournament"
        description="Update tournament metadata without leaving the workspace."
        onSubmit={handleTournamentSubmit}
        isSubmitting={updateTournamentMutation.isPending}
        submittingLabel="Updating tournament..."
        errorMessage={updateTournamentMutation.isError ? updateTournamentMutation.error.message : undefined}
        isDirty={isTournamentDirty}
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="workspace-tournament-name">Name</Label>
            <Input
              id="workspace-tournament-name"
              value={tournamentFormData.name}
              onChange={(event) =>
                setTournamentFormData((current) => ({ ...current, name: event.target.value }))
              }
            />
          </div>

          <div>
            <Label htmlFor="workspace-tournament-number">Number</Label>
            <Input
              id="workspace-tournament-number"
              type="number"
              value={tournamentFormData.number ?? ""}
              onChange={(event) =>
                setTournamentFormData((current) => ({
                  ...current,
                  number: event.target.value ? Number(event.target.value) : null,
                }))
              }
            />
          </div>

          <div>
            <Label htmlFor="workspace-tournament-description">Description</Label>
            <Textarea
              id="workspace-tournament-description"
              value={tournamentFormData.description}
              onChange={(event) =>
                setTournamentFormData((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="workspace-tournament-is-league"
              checked={tournamentFormData.is_league}
              onCheckedChange={(checked) =>
                setTournamentFormData((current) => ({
                  ...current,
                  is_league: checked === true,
                }))
              }
            />
            <Label htmlFor="workspace-tournament-is-league" className="cursor-pointer">
              Treat as league season
            </Label>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="workspace-tournament-is-finished"
              checked={tournamentFormData.is_finished}
              onCheckedChange={(checked) =>
                setTournamentFormData((current) => ({
                  ...current,
                  is_finished: checked === true,
                }))
              }
            />
            <Label htmlFor="workspace-tournament-is-finished" className="cursor-pointer">
              Mark tournament as finished
            </Label>
          </div>

          <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="workspace-start-date">Start Date</FieldLabel>
              <DatePicker
                id="workspace-start-date"
                value={tournamentFormData.start_date}
                onChange={(value) =>
                  setTournamentFormData((current) => ({ ...current, start_date: value }))
                }
                placeholder="June 01, 2025"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="workspace-end-date">End Date</FieldLabel>
              <DatePicker
                id="workspace-end-date"
                value={tournamentFormData.end_date}
                onChange={(value) =>
                  setTournamentFormData((current) => ({ ...current, end_date: value }))
                }
                placeholder="June 30, 2025"
              />
            </Field>
          </FieldGroup>
        </div>
      </EntityFormDialog>

      <EntityFormDialog
        open={groupDialogOpen}
        onOpenChange={(open) => {
          setGroupDialogOpen(open);
          if (!open) {
            resetGroupDialog();
          }
        }}
        title={editingGroup ? "Edit Group" : "Create Group"}
        description="Create a manual group or resolve a Challonge slug to link external metadata."
        onSubmit={handleGroupSubmit}
        isSubmitting={saveGroupMutation.isPending}
        submittingLabel={editingGroup ? "Updating group..." : "Creating group..."}
        errorMessage={groupFormError}
        isDirty={isGroupDirty}
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="workspace-group-name">Name</Label>
            <Input
              id="workspace-group-name"
              value={groupFormData.name}
              onChange={(event) =>
                setGroupFormData((current) => ({ ...current, name: event.target.value }))
              }
            />
          </div>

          <div>
            <Label htmlFor="workspace-group-description">Description</Label>
            <Textarea
              id="workspace-group-description"
              value={groupFormData.description}
              onChange={(event) =>
                setGroupFormData((current) => ({ ...current, description: event.target.value }))
              }
            />
          </div>

          <div>
            <Label htmlFor="workspace-group-type">Type</Label>
            <Select
              value={groupFormData.is_groups ? "groups" : "playoffs"}
              onValueChange={(value) =>
                setGroupFormData((current) => ({ ...current, is_groups: value === "groups" }))
              }
            >
              <SelectTrigger id="workspace-group-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="groups">Group stage</SelectItem>
                <SelectItem value="playoffs">Playoffs</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3 rounded-xl border border-border/60 bg-muted/10 p-4">
            <div className="space-y-1">
              <Label htmlFor="workspace-group-challonge">Challonge slug or URL</Label>
              <p className="text-sm text-muted-foreground">
                Optional. Resolve a Challonge tournament to store its slug and ID without syncing data yet.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="workspace-group-challonge"
                value={groupFormData.challongeLookup}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setGroupLookupPreview(null);
                  setGroupFormError(undefined);
                  setGroupFormData((current) => ({
                    ...current,
                    challongeLookup: nextValue,
                    challonge_id: null,
                    challonge_slug: null,
                  }));
                }}
                placeholder="group-a or https://challonge.com/group-a"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleResolveChallonge}
                disabled={lookupChallongeMutation.isPending}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Resolve
              </Button>
              {(groupFormData.challonge_id || groupFormData.challonge_slug) && !lookupChallongeMutation.isPending ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setGroupLookupPreview(null);
                    setGroupFormError(undefined);
                    setGroupFormData((current) => ({
                      ...current,
                      challongeLookup: "",
                      challonge_id: null,
                      challonge_slug: null,
                    }));
                  }}
                >
                  Clear link
                </Button>
              ) : null}
            </div>
            {groupFormData.challonge_id && groupFormData.challonge_slug ? (
              <div className="rounded-lg border border-border/60 bg-background/70 p-3 text-sm">
                <div className="font-medium">
                  Linked Challonge tournament {groupLookupPreview?.name ? `- ${groupLookupPreview.name}` : ""}
                </div>
                <div className="text-muted-foreground">Slug: {groupFormData.challonge_slug}</div>
                <div className="text-muted-foreground">ID: {groupFormData.challonge_id}</div>
              </div>
            ) : null}
          </div>
        </div>
      </EntityFormDialog>

      <EntityFormDialog
        open={teamDialogOpen}
        onOpenChange={(open) => {
          setTeamDialogOpen(open);
          if (!open) {
            resetTeamDialog();
          }
        }}
        title={editingTeam ? "Edit Team" : "Create Team"}
        description="Manage team metadata inside this tournament workspace."
        onSubmit={handleTeamSubmit}
        isSubmitting={saveTeamMutation.isPending}
        submittingLabel={editingTeam ? "Updating team..." : "Creating team..."}
        errorMessage={teamFormError}
        isDirty={isTeamDirty}
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="workspace-team-name">Team Name</Label>
            <Input
              id="workspace-team-name"
              value={teamFormData.name}
              onChange={(event) =>
                setTeamFormData((current) => ({ ...current, name: event.target.value }))
              }
            />
          </div>

          <div>
            <Label htmlFor="workspace-team-captain">Captain User ID</Label>
            <Input
              id="workspace-team-captain"
              type="number"
              value={teamFormData.captain_id || ""}
              onChange={(event) =>
                setTeamFormData((current) => ({
                  ...current,
                  captain_id: event.target.value ? Number(event.target.value) : 0,
                }))
              }
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="workspace-team-avg-sr">Average SR</Label>
              <Input
                id="workspace-team-avg-sr"
                type="number"
                step="0.1"
                value={teamFormData.avg_sr}
                onChange={(event) =>
                  setTeamFormData((current) => ({
                    ...current,
                    avg_sr: event.target.value ? Number(event.target.value) : 0,
                  }))
                }
              />
            </div>

            <div>
              <Label htmlFor="workspace-team-total-sr">Total SR</Label>
              <Input
                id="workspace-team-total-sr"
                type="number"
                value={teamFormData.total_sr}
                onChange={(event) =>
                  setTeamFormData((current) => ({
                    ...current,
                    total_sr: event.target.value ? Number(event.target.value) : 0,
                  }))
                }
              />
            </div>
          </div>
        </div>
      </EntityFormDialog>

      <EntityFormDialog
        open={encounterDialogOpen}
        onOpenChange={(open) => {
          setEncounterDialogOpen(open);
          if (!open) {
            resetEncounterDialog();
          }
        }}
        title={editingEncounter ? "Edit Encounter" : "Create Encounter"}
        description="Create or update tournament encounters without leaving the workspace."
        onSubmit={handleEncounterSubmit}
        isSubmitting={saveEncounterMutation.isPending}
        submittingLabel={editingEncounter ? "Updating encounter..." : "Creating encounter..."}
        errorMessage={encounterFormError}
        isDirty={isEncounterDirty}
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="workspace-encounter-name">Encounter Name</Label>
            <Input
              id="workspace-encounter-name"
              value={encounterFormData.name}
              onChange={(event) =>
                setEncounterFormData((current) => ({ ...current, name: event.target.value }))
              }
            />
          </div>

          <div>
            <Label htmlFor="workspace-encounter-group">Group</Label>
            <Select
              value={encounterFormData.tournament_group_id?.toString() ?? "none"}
              onValueChange={(value) =>
                setEncounterFormData((current) => ({
                  ...current,
                  tournament_group_id: value === "none" ? null : Number(value),
                }))
              }
            >
              <SelectTrigger id="workspace-encounter-group">
                <SelectValue placeholder="Select group" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No group</SelectItem>
                {groups.map((group) => (
                  <SelectItem key={group.id} value={group.id.toString()}>
                    {group.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="workspace-encounter-home">Home Team</Label>
              <Select
                value={encounterFormData.home_team_id ? encounterFormData.home_team_id.toString() : ""}
                onValueChange={(value) =>
                  setEncounterFormData((current) => ({
                    ...current,
                    home_team_id: Number(value),
                  }))
                }
              >
                <SelectTrigger id="workspace-encounter-home">
                  <SelectValue placeholder="Select home team" />
                </SelectTrigger>
                <SelectContent>
                  {teams.map((team) => (
                    <SelectItem key={team.id} value={team.id.toString()}>
                      {team.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="workspace-encounter-away">Away Team</Label>
              <Select
                value={encounterFormData.away_team_id ? encounterFormData.away_team_id.toString() : ""}
                onValueChange={(value) =>
                  setEncounterFormData((current) => ({
                    ...current,
                    away_team_id: Number(value),
                  }))
                }
              >
                <SelectTrigger id="workspace-encounter-away">
                  <SelectValue placeholder="Select away team" />
                </SelectTrigger>
                <SelectContent>
                  {teams.map((team) => (
                    <SelectItem key={team.id} value={team.id.toString()}>
                      {team.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="workspace-encounter-round">Round</Label>
            <Input
              id="workspace-encounter-round"
              type="number"
              min="1"
              value={encounterFormData.round}
              onChange={(event) =>
                setEncounterFormData((current) => ({
                  ...current,
                  round: event.target.value ? Number(event.target.value) : 1,
                }))
              }
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="workspace-encounter-home-score">Home Score</Label>
              <Input
                id="workspace-encounter-home-score"
                type="number"
                min="0"
                value={encounterFormData.home_score}
                onChange={(event) =>
                  setEncounterFormData((current) => ({
                    ...current,
                    home_score: event.target.value ? Number(event.target.value) : 0,
                  }))
                }
              />
            </div>

            <div>
              <Label htmlFor="workspace-encounter-away-score">Away Score</Label>
              <Input
                id="workspace-encounter-away-score"
                type="number"
                min="0"
                value={encounterFormData.away_score}
                onChange={(event) =>
                  setEncounterFormData((current) => ({
                    ...current,
                    away_score: event.target.value ? Number(event.target.value) : 0,
                  }))
                }
              />
            </div>
          </div>

          <div>
            <Label htmlFor="workspace-encounter-status">Status</Label>
            <Select
              value={encounterFormData.status}
              onValueChange={(value) =>
                setEncounterFormData((current) => ({ ...current, status: value }))
              }
            >
              <SelectTrigger id="workspace-encounter-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </EntityFormDialog>

      <EntityFormDialog
        open={standingDialogOpen}
        onOpenChange={(open) => {
          setStandingDialogOpen(open);
          if (!open) {
            resetStandingDialog();
          }
        }}
        title="Edit Standing"
        description="Adjust a stored standings row manually."
        onSubmit={handleStandingSubmit}
        isSubmitting={updateStandingMutation.isPending}
        submittingLabel="Updating standing..."
        errorMessage={updateStandingMutation.isError ? updateStandingMutation.error.message : undefined}
        isDirty={isStandingDirty}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="workspace-standing-position">Position</Label>
            <Input
              id="workspace-standing-position"
              type="number"
              min="1"
              value={standingFormData.position}
              onChange={(event) =>
                setStandingFormData((current) => ({
                  ...current,
                  position: event.target.value ? Number(event.target.value) : 0,
                }))
              }
            />
          </div>

          <div>
            <Label htmlFor="workspace-standing-points">Points</Label>
            <Input
              id="workspace-standing-points"
              type="number"
              step="0.1"
              value={standingFormData.points}
              onChange={(event) =>
                setStandingFormData((current) => ({
                  ...current,
                  points: event.target.value ? Number(event.target.value) : 0,
                }))
              }
            />
          </div>

          <div>
            <Label htmlFor="workspace-standing-win">Wins</Label>
            <Input
              id="workspace-standing-win"
              type="number"
              min="0"
              value={standingFormData.win}
              onChange={(event) =>
                setStandingFormData((current) => ({
                  ...current,
                  win: event.target.value ? Number(event.target.value) : 0,
                }))
              }
            />
          </div>

          <div>
            <Label htmlFor="workspace-standing-draw">Draws</Label>
            <Input
              id="workspace-standing-draw"
              type="number"
              min="0"
              value={standingFormData.draw}
              onChange={(event) =>
                setStandingFormData((current) => ({
                  ...current,
                  draw: event.target.value ? Number(event.target.value) : 0,
                }))
              }
            />
          </div>

          <div>
            <Label htmlFor="workspace-standing-lose">Losses</Label>
            <Input
              id="workspace-standing-lose"
              type="number"
              min="0"
              value={standingFormData.lose}
              onChange={(event) =>
                setStandingFormData((current) => ({
                  ...current,
                  lose: event.target.value ? Number(event.target.value) : 0,
                }))
              }
            />
          </div>
        </div>
      </EntityFormDialog>

      <DeleteConfirmDialog
        open={tournamentDeleteOpen}
        onOpenChange={setTournamentDeleteOpen}
        onConfirm={() => deleteTournamentMutation.mutate()}
        title="Delete Tournament"
        description={`Delete "${tournament.name}"? This removes the tournament and all linked workspace data.`}
        cascadeInfo={[
          "Tournament groups",
          "Teams and players",
          "Encounters and matches",
          "Standings rows",
        ]}
        isDeleting={deleteTournamentMutation.isPending}
      />

      <DeleteConfirmDialog
        open={!!groupPendingDelete}
        onOpenChange={(open) => {
          if (!open) {
            setGroupPendingDelete(null);
          }
        }}
        onConfirm={() => {
          if (groupPendingDelete) {
            deleteGroupMutation.mutate(groupPendingDelete.id);
          }
        }}
        title="Delete Group"
        description={`Delete "${groupPendingDelete?.name ?? "this group"}"? Linked encounters will cascade and related standings rows will be removed.`}
        cascadeInfo={["Encounters linked to this group", "Standings rows for this group"]}
        isDeleting={deleteGroupMutation.isPending}
      />

      <DeleteConfirmDialog
        open={!!teamPendingDelete}
        onOpenChange={(open) => {
          if (!open) {
            setTeamPendingDelete(null);
          }
        }}
        onConfirm={() => {
          if (teamPendingDelete) {
            deleteTeamMutation.mutate(teamPendingDelete.id);
          }
        }}
        title="Delete Team"
        description={`Delete "${teamPendingDelete?.name ?? "this team"}"? This also removes roster members and related match records.`}
        cascadeInfo={["Players in this team", "Related encounter references", "Stored standings rows"]}
        isDeleting={deleteTeamMutation.isPending}
      />

      <DeleteConfirmDialog
        open={!!encounterPendingDelete}
        onOpenChange={(open) => {
          if (!open) {
            setEncounterPendingDelete(null);
          }
        }}
        onConfirm={() => {
          if (encounterPendingDelete) {
            deleteEncounterMutation.mutate(encounterPendingDelete.id);
          }
        }}
        title="Delete Encounter"
        description={`Delete "${encounterPendingDelete?.name ?? "this encounter"}"? This action cannot be undone.`}
        cascadeInfo={["All matches in this encounter", "Attached match statistics and logs"]}
        isDeleting={deleteEncounterMutation.isPending}
      />

      <DeleteConfirmDialog
        open={!!standingPendingDelete}
        onOpenChange={(open) => {
          if (!open) {
            setStandingPendingDelete(null);
          }
        }}
        onConfirm={() => {
          if (standingPendingDelete) {
            deleteStandingMutation.mutate(standingPendingDelete.id);
          }
        }}
        title="Delete Standing"
        description={`Delete the standings row for "${standingPendingDelete?.team?.name ?? "this team"}"?`}
        isDeleting={deleteStandingMutation.isPending}
      />
    </div>
  );
}
