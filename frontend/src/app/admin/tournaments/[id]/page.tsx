"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleAlert,
  ArrowLeft,
  BarChart3,
  CalendarDays,
  CheckCircle,
  CheckCircle2,
  Clock,
  FileCheck2,
  FileX2,
  FolderInput,
  Hash,
  History,
  LayoutGrid,
  Layers3,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Link2,
  ListChecks,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Trash2,
  Trophy,
  Upload,
  Users,
  Wifi,
  WifiOff,
  XCircle
} from "lucide-react";

import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { EntityFormDialog } from "@/components/admin/EntityFormDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { StatusIcon } from "@/components/admin/StatusIcon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { hasUnsavedChanges } from "@/lib/form-change";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import adminService from "@/services/admin.service";
import balancerAdminService from "@/services/balancer-admin.service";
import encounterService from "@/services/encounter.service";
import teamService from "@/services/team.service";
import tournamentService from "@/services/tournament.service";
import workspaceService from "@/services/workspace.service";
import type {
  DiscordChannelInput,
  DiscordChannelRead,
  EncounterCreateInput,
  EncounterUpdateInput,
  LogProcessingRecord,
  StandingUpdateInput,
  TeamCreateInput,
  TeamUpdateInput,
  TournamentUpdateInput
} from "@/types/admin.types";
import type { Encounter } from "@/types/encounter.types";
import type { Team } from "@/types/team.types";
import type {
  Standings,
  Tournament,
  TournamentStatus
} from "@/types/tournament.types";
import type { DivisionGridVersion } from "@/types/workspace.types";
import { TournamentStatusControl } from "./components/TournamentStatusControl";
import { StageManager } from "./components/StageManager";
import { ChallongeSyncPanel } from "./components/ChallongeSyncPanel";

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
    // fall back to raw slug handling
  }

  return trimmed.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean).at(-1) ?? trimmed;
}

type TournamentFormState = {
  number: number | null;
  name: string;
  description: string;
  challonge_slug: string;
  is_league: boolean;
  is_finished: boolean;
  start_date: string;
  end_date: string;
  win_points: number;
  draw_points: number;
  loss_points: number;
  registration_opens_at: string;
  registration_closes_at: string;
  check_in_opens_at: string;
  check_in_closes_at: string;
  division_grid_version_id: number | null;
};

type TeamFormState = {
  name: string;
  captain_id: number;
  avg_sr: number;
  total_sr: number;
};

type EncounterFormState = {
  name: string;
  stage_id: number | null;
  stage_item_id: number | null;
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

function toDateTimeInput(value?: Date | string | null) {
  if (!value) return "";
  const d = new Date(value);
  return d.toISOString().slice(0, 16);
}

function getTournamentForm(tournament: Tournament): TournamentFormState {
  return {
    number: tournament.number ?? null,
    name: tournament.name,
    description: tournament.description ?? "",
    challonge_slug: tournament.challonge_slug ?? "",
    is_league: tournament.is_league,
    is_finished: tournament.is_finished,
    start_date: toDateInput(tournament.start_date),
    end_date: toDateInput(tournament.end_date),
    win_points: tournament.win_points ?? 1.0,
    draw_points: tournament.draw_points ?? 0.5,
    loss_points: tournament.loss_points ?? 0.0,
    registration_opens_at: toDateTimeInput(tournament.registration_opens_at),
    registration_closes_at: toDateTimeInput(tournament.registration_closes_at),
    check_in_opens_at: toDateTimeInput(tournament.check_in_opens_at),
    check_in_closes_at: toDateTimeInput(tournament.check_in_closes_at),
    division_grid_version_id: tournament.division_grid_version_id ?? null,
  };
}

function getEmptyTeamForm(): TeamFormState {
  return {
    name: "",
    captain_id: 0,
    avg_sr: 0,
    total_sr: 0
  };
}

function getTeamForm(team: Team): TeamFormState {
  return {
    name: team.name,
    captain_id: team.captain_id,
    avg_sr: team.avg_sr,
    total_sr: team.total_sr
  };
}

function getEmptyEncounterForm(
  defaultStageId: number | null,
  defaultStageItemId: number | null
): EncounterFormState {
  return {
    name: "",
    stage_id: defaultStageId,
    stage_item_id: defaultStageItemId,
    home_team_id: 0,
    away_team_id: 0,
    round: 1,
    home_score: 0,
    away_score: 0,
    status: "open"
  };
}

function getEncounterForm(encounter: Encounter): EncounterFormState {
  return {
    name: encounter.name,
    stage_id: encounter.stage_id ?? null,
    stage_item_id: encounter.stage_item_id ?? null,
    home_team_id: encounter.home_team_id,
    away_team_id: encounter.away_team_id,
    round: encounter.round,
    home_score: encounter.score.home,
    away_score: encounter.score.away,
    status: encounter.status
  };
}

function getStandingForm(standing: Standings): StandingFormState {
  return {
    position: standing.position,
    points: standing.points,
    win: standing.win,
    draw: standing.draw,
    lose: standing.lose
  };
}

function getEncounterStageLabel(encounter: Encounter) {
  return encounter.stage_item?.name ?? encounter.stage?.name ?? "-";
}

function getStandingScopeKey(standing: Standings): string {
  if (standing.stage_item_id != null) return `stage-item-${standing.stage_item_id}`;
  if (standing.stage_id != null) return `stage-${standing.stage_id}`;
  return `standing-${standing.id}`;
}

function getStandingScopeLabel(standing: Standings): string {
  return standing.stage_item?.name ?? standing.stage?.name ?? "-";
}

const DETAIL_TABLE_PREVIEW = 8;
const adminDetailTableShell = "overflow-hidden rounded-lg border border-border/40";
const adminDetailTableHeaderRow = "hover:bg-transparent";
const adminDetailTableHead =
  "sticky top-0 z-10 h-8 bg-muted/20 text-[11px] font-medium text-muted-foreground/70 first:pl-3 last:pr-3";
const adminDetailTableRow = "border-b border-border/30 transition-colors hover:bg-accent/20";
const adminDetailTableCell = "py-2 text-[13px] first:pl-3 last:pr-3 align-middle";

export default function AdminTournamentWorkspacePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const tournamentId = Number(params.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { hasPermission, isSuperuser } = usePermissions();
  const importTeamsFileRef = useRef<HTMLInputElement>(null);

  const canUpdateTournament = hasPermission("tournament.update");
  const canDeleteTournament = hasPermission("tournament.delete");
  const canReadAnalytics = hasPermission("analytics.read");
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
    enabled: Number.isFinite(tournamentId) && tournamentId > 0
  });

  const teamsQuery = useQuery({
    queryKey: ["admin", "tournament", tournamentId, "teams"],
    queryFn: () => teamService.getAll(tournamentId),
    enabled: Number.isFinite(tournamentId) && tournamentId > 0
  });

  const divisionGridsQuery = useQuery({
    queryKey: ["admin", "tournament", tournamentId, "division-grids"],
    queryFn: async () => {
      const workspaceId = tournamentQuery.data?.workspace_id;
      if (!workspaceId) return [];
      return workspaceService.getDivisionGrids(workspaceId);
    },
    enabled: Boolean(tournamentQuery.data?.workspace_id)
  });

  const standingsQuery = useQuery({
    queryKey: ["admin", "tournament", tournamentId, "standings"],
    queryFn: () => tournamentService.getStandings(tournamentId),
    enabled: Number.isFinite(tournamentId) && tournamentId > 0
  });

  const encountersQuery = useQuery({
    queryKey: ["admin", "tournament", tournamentId, "encounters"],
    queryFn: () => encounterService.getAll(1, "", tournamentId, -1),
    enabled: Number.isFinite(tournamentId) && tournamentId > 0
  });

  const discordChannelQuery = useQuery({
    queryKey: ["admin", "tournament", tournamentId, "discord-channel"],
    queryFn: () => adminService.getDiscordChannel(tournamentId),
    enabled: Number.isFinite(tournamentId) && tournamentId > 0
  });

  const logHistoryQuery = useQuery({
    queryKey: ["admin", "tournament", tournamentId, "log-history"],
    queryFn: () => adminService.getLogHistory(tournamentId, { limit: 50 }),
    enabled: Number.isFinite(tournamentId) && tournamentId > 0,
    refetchInterval: 10_000
  });

  const retryLogMutation = useMutation({
    mutationFn: (recordId: number) => adminService.retryLogRecord(recordId),
    onSuccess: () => logHistoryQuery.refetch()
  });

  const processAllLogsMutation = useMutation({
    mutationFn: () => adminService.processAllTournamentLogs(tournamentId),
    onSuccess: () => {
      toast({ title: "Processing queued for all S3 logs" });
      logHistoryQuery.refetch();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const invalidateWorkspace = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin", "tournament", tournamentId] }),
      queryClient.invalidateQueries({ queryKey: ["admin", "tournament", tournamentId, "teams"] }),
      queryClient.invalidateQueries({
        queryKey: ["admin", "tournament", tournamentId, "standings"]
      }),
      queryClient.invalidateQueries({
        queryKey: ["admin", "tournament", tournamentId, "encounters"]
      }),
      queryClient.invalidateQueries({ queryKey: ["tournaments"] }),
      queryClient.invalidateQueries({ queryKey: ["teams"] }),
      queryClient.invalidateQueries({ queryKey: ["encounters"] }),
      queryClient.invalidateQueries({ queryKey: ["standings"] })
    ]);
  };

  const tournament = tournamentQuery.data;
  const stages = tournament?.stages ?? [];
  const teams = teamsQuery.data?.results ?? [];
  const divisionGridVersions: DivisionGridVersion[] = (divisionGridsQuery.data ?? [])
    .flatMap((grid) => grid.versions)
    .slice()
    .sort((left, right) => right.version - left.version);
  const standings = standingsQuery.data ?? [];
  const encounters = encountersQuery.data?.results ?? [];
  const defaultStage = stages[0] ?? null;
  const defaultStageId = defaultStage?.id ?? null;
  const defaultStageItemId = defaultStage?.items[0]?.id ?? null;
  const completedEncounterCount = encounters.filter(
    (encounter) => encounter.status?.toUpperCase() === "COMPLETED"
  ).length;
  const hasChallongeSource = Boolean(
    tournament?.challonge_slug || stages.some((stage) => Boolean(stage.challonge_slug))
  );
  const canCreateEncounterNow = canCreateEncounter && teams.length >= 2 && stages.length > 0;
  const canManageStandingsNow = canRecalculateStandings && encounters.length > 0;
  const workspacePhases = [
    {
      label: "Structure & roster",
      icon: Layers3,
      done: stages.length > 0 && teams.length > 0,
      description:
        stages.length > 0 && teams.length > 0
          ? `${stages.length} stages configured and ${teams.length} teams loaded.`
          : stages.length === 0 && teams.length === 0
            ? "Create the tournament structure and add teams before scheduling play."
            : stages.length === 0
              ? "Create at least one stage before continuing."
              : "Add or sync teams to complete the roster.",
      metrics: [
        {
          label: "Stages",
          value: stages.length ? `${stages.length} ready` : "Missing"
        },
        {
          label: "Teams",
          value: teams.length ? `${teams.length} ready` : "Missing"
        }
      ]
    },
    {
      label: "Play & results",
      icon: Trophy,
      done: encounters.length > 0 && standings.length > 0,
      description:
        encounters.length > 0 && standings.length > 0
          ? `${encounters.length} encounters tracked and standings available.`
          : encounters.length === 0 && standings.length === 0
            ? "Create encounters first, then calculate standings once results exist."
            : encounters.length === 0
              ? "Schedule or sync encounters before calculating standings."
              : "Calculate standings after encounters have been completed.",
      metrics: [
        {
          label: "Encounters",
          value: encounters.length ? `${encounters.length} ready` : "Missing"
        },
        {
          label: "Standings",
          value: standings.length ? `${standings.length} ready` : "Missing"
        }
      ]
    }
  ];

  const [tournamentDialogOpen, setTournamentDialogOpen] = useState(false);
  const [tournamentFormData, setTournamentFormData] = useState<TournamentFormState>({
    number: null,
    name: "",
    description: "",
    challonge_slug: "",
    is_league: false,
    is_finished: false,
    start_date: "",
    end_date: "",
    win_points: 1.0,
    draw_points: 0.5,
    loss_points: 0.0,
    registration_opens_at: "",
    registration_closes_at: "",
    check_in_opens_at: "",
    check_in_closes_at: "",
    division_grid_version_id: null,
  });

  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [teamFormData, setTeamFormData] = useState<TeamFormState>(getEmptyTeamForm());
  const [teamFormError, setTeamFormError] = useState<string | undefined>();
  const [teamPendingDelete, setTeamPendingDelete] = useState<Team | null>(null);

  const [encounterDialogOpen, setEncounterDialogOpen] = useState(false);
  const [editingEncounter, setEditingEncounter] = useState<Encounter | null>(null);
  const [encounterFormData, setEncounterFormData] = useState<EncounterFormState>(
    getEmptyEncounterForm(defaultStageId, defaultStageItemId)
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
    lose: 0
  });
  const [tournamentDeleteOpen, setTournamentDeleteOpen] = useState(false);
  const [standingPendingDelete, setStandingPendingDelete] = useState<Standings | null>(null);
  const [standingsGroupFilter, setStandingsGroupFilter] = useState<string>("all");
  const [standingsExpanded, setStandingsExpanded] = useState(false);
  const [standingsSort, setStandingsSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(
    null
  );

  // Discord channel state
  const [discordChannelDialogOpen, setDiscordChannelDialogOpen] = useState(false);
  const [discordChannelForm, setDiscordChannelForm] = useState<DiscordChannelInput>({
    guild_id: "",
    channel_id: "",
    channel_name: "",
    is_active: true
  });
  const [discordChannelDeleteOpen, setDiscordChannelDeleteOpen] = useState(false);

  const resetTournamentDialog = () => {
    setTournamentDialogOpen(false);
    if (tournament) {
      setTournamentFormData(getTournamentForm(tournament));
    }
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
    setEncounterFormData(getEmptyEncounterForm(defaultStageId, defaultStageItemId));
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
    }
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
    }
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
    }
  });

  const saveTeamMutation = useMutation({
    mutationFn: async ({
      mode,
      teamId,
      data
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
    }
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
    }
  });

  const syncTeamsMutation = useMutation({
    mutationFn: () => adminService.syncTeamsFromChallonge(tournamentId),
    onSuccess: async () => {
      await invalidateWorkspace();
      toast({ title: "Teams synced from Challonge" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const importTeamsMutation = useMutation({
    mutationFn: (file: File) => balancerAdminService.importTeamsFromJson(tournamentId, file),
    onSuccess: async (result) => {
      await invalidateWorkspace();
      toast({ title: "Teams imported", description: `${result.imported_teams} teams created.` });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to import teams",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const saveEncounterMutation = useMutation({
    mutationFn: async ({
      mode,
      encounterId,
      data
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
        title: variables.mode === "create" ? "Encounter created" : "Encounter updated"
      });
    },
    onError: (error: Error) => {
      setEncounterFormError(error.message);
    }
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
    }
  });

  const syncEncountersMutation = useMutation({
    mutationFn: () => adminService.syncEncountersFromChallonge(tournamentId),
    onSuccess: async () => {
      await invalidateWorkspace();
      toast({ title: "Encounters synced from Challonge" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
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
    }
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
    }
  });

  const calculateStandingsMutation = useMutation({
    mutationFn: () => adminService.calculateStandings(tournamentId),
    onSuccess: async () => {
      await invalidateWorkspace();
      toast({ title: "Standings calculated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
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
    }
  });

  const saveDiscordChannelMutation = useMutation({
    mutationFn: (data: DiscordChannelInput) => adminService.setDiscordChannel(tournamentId, data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["admin", "tournament", tournamentId, "discord-channel"]
      });
      setDiscordChannelDialogOpen(false);
      toast({ title: "Discord channel configured" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const deleteDiscordChannelMutation = useMutation({
    mutationFn: () => adminService.deleteDiscordChannel(tournamentId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["admin", "tournament", tournamentId, "discord-channel"]
      });
      setDiscordChannelDeleteOpen(false);
      toast({ title: "Discord channel removed" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const openTournamentDialog = () => {
    if (!tournament) return;
    updateTournamentMutation.reset();
    setTournamentFormData(getTournamentForm(tournament));
    setTournamentDialogOpen(true);
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
    setEncounterFormData(getEmptyEncounterForm(defaultStageId, defaultStageItemId));
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

  const handleTournamentSubmit = (event: FormEvent) => {
    event.preventDefault();

    const payload: TournamentUpdateInput = {
      number: tournamentFormData.number,
      name: tournamentFormData.name.trim(),
      description: tournamentFormData.description.trim() || null,
      challonge_slug: tournamentFormData.challonge_slug
        ? normalizeChallongeSlug(tournamentFormData.challonge_slug)
        : null,
      is_league: tournamentFormData.is_league,
      is_finished: tournamentFormData.is_finished,
      start_date: tournamentFormData.start_date,
      end_date: tournamentFormData.end_date,
      win_points: tournamentFormData.win_points,
      draw_points: tournamentFormData.draw_points,
      loss_points: tournamentFormData.loss_points,
      registration_opens_at: tournamentFormData.registration_opens_at || null,
      registration_closes_at: tournamentFormData.registration_closes_at || null,
      check_in_opens_at: tournamentFormData.check_in_opens_at || null,
      check_in_closes_at: tournamentFormData.check_in_closes_at || null,
      division_grid_version_id: tournamentFormData.division_grid_version_id
    };

    updateTournamentMutation.mutate(payload);
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
          total_sr: teamFormData.total_sr
        } satisfies TeamUpdateInput)
      : ({
          name: teamFormData.name.trim(),
          tournament_id: tournamentId,
          captain_id: teamFormData.captain_id,
          avg_sr: teamFormData.avg_sr,
          total_sr: teamFormData.total_sr
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

    if (encounterFormData.stage_id == null) {
      setEncounterFormError("Select a stage before saving the encounter.");
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
          stage_id: encounterFormData.stage_id,
          stage_item_id: encounterFormData.stage_item_id,
          home_team_id: encounterFormData.home_team_id,
          away_team_id: encounterFormData.away_team_id,
          round: encounterFormData.round,
          home_score: encounterFormData.home_score,
          away_score: encounterFormData.away_score,
          status: encounterFormData.status
        } satisfies EncounterUpdateInput)
      : ({
          name: encounterFormData.name.trim(),
          tournament_id: tournamentId,
          stage_id: encounterFormData.stage_id,
          stage_item_id: encounterFormData.stage_item_id,
          home_team_id: encounterFormData.home_team_id,
          away_team_id: encounterFormData.away_team_id,
          round: encounterFormData.round,
          home_score: encounterFormData.home_score,
          away_score: encounterFormData.away_score,
          status: encounterFormData.status
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
      lose: standingFormData.lose
    };

    updateStandingMutation.mutate({ standingId: editingStanding.id, data: payload });
  };

  const tournamentFormInitial = tournament ? getTournamentForm(tournament) : tournamentFormData;
  const teamFormInitial = editingTeam ? getTeamForm(editingTeam) : getEmptyTeamForm();
  const encounterFormInitial = editingEncounter
    ? getEncounterForm(editingEncounter)
    : getEmptyEncounterForm(defaultStageId, defaultStageItemId);
  const standingFormInitial = editingStanding
    ? getStandingForm(editingStanding)
    : { position: 0, points: 0, win: 0, draw: 0, lose: 0 };

  const isTournamentDirty =
    tournamentDialogOpen && hasUnsavedChanges(tournamentFormData, tournamentFormInitial);
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
    <div className="space-y-4">
      <Card className="border-border/40">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <CardTitle className="text-lg font-semibold tracking-tight truncate">
                  {tournament.name}
                </CardTitle>
                {tournament.is_finished ? (
                  <StatusIcon icon={CheckCircle} label="Finished" variant="muted" />
                ) : (
                  <StatusIcon icon={XCircle} label="Live ops" variant="success" />
                )}
              </div>
              <CardDescription className="mt-1">
                Manage tournament settings, groups, teams, encounters, and standings in one
                workspace.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              <Button asChild variant="outline">
                <Link href="/admin/tournaments">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Tournaments
                </Link>
              </Button>
              {canReadAnalytics ? (
                <Button asChild variant="outline">
                  <Link href={`/tournaments/analytics?tournamentId=${tournament.id}`}>
                    <BarChart3 className="mr-2 h-4 w-4" />
                    Open Analytics
                  </Link>
                </Button>
              ) : null}
              {canUpdateTournament ? (
                <Button variant="outline" onClick={openTournamentDialog}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit Tournament
                </Button>
              ) : null}
              {canUpdateTournament && isSuperuser ? (
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
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="border-t border-border/40 pt-3">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-muted-foreground">
              <TournamentStatusControl tournament={tournament} />
              <span className="flex items-center gap-1.5">
                <ShieldAlert className="size-3.5" />
                {tournament.is_finished ? "Finished" : "Active"} ·{" "}
                {tournament.is_league ? "League" : "Tournament"}
              </span>
              <span className="flex items-center gap-1.5">
                <CalendarDays className="size-3.5" />
                {formatDate(tournament.start_date)} — {formatDate(tournament.end_date)}
              </span>
              <span className="flex items-center gap-1.5">
                <Users className="size-3.5" />
                {teams.length} teams · {tournament.participants_count ?? teams.length} participants
              </span>
              <span className="flex items-center gap-1.5">
                <Layers3 className="size-3.5" />
                {stages.length} stages · {encounters.length} encounters · {standings.length}{" "}
                standings
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="setup">Setup</TabsTrigger>
          <TabsTrigger value="matches">Play & Results</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        {/* ── Tab: Overview ──────────────────────────────────────────────── */}
        <TabsContent value="overview" className="space-y-4">
          <Card className="border-border/40">
            <CardHeader className="flex flex-row items-center justify-between gap-3 py-3 px-4">
              <div className="flex items-center gap-2 min-w-0">
                <ListChecks className="size-4 text-muted-foreground shrink-0" />
                <CardTitle className="text-sm font-semibold">Setup Checklist</CardTitle>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusIcon
                  icon={Link2}
                  label={hasChallongeSource ? "Challonge linked" : "No Challonge link"}
                  variant={hasChallongeSource ? "success" : "muted"}
                />
                <Badge variant={completedEncounterCount > 0 ? "secondary" : "outline"}>
                  {completedEncounterCount} completed encounters
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 xl:grid-cols-2">
                {workspacePhases.map((item) => {
                  const PhaseIcon = item.icon;

                  return (
                    <div
                      key={item.label}
                      className="rounded-xl border border-border/60 bg-background/70 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="rounded-lg border border-border/60 bg-background/80 p-2">
                              <PhaseIcon className="size-4 text-muted-foreground" />
                            </div>
                            <p className="text-sm font-medium">{item.label}</p>
                          </div>
                          <p className="mt-3 text-sm text-muted-foreground">{item.description}</p>
                        </div>
                        {item.done ? (
                          <StatusIcon icon={CheckCircle} label="Done" variant="success" />
                        ) : (
                          <StatusIcon icon={Clock} label="Pending" variant="muted" />
                        )}
                      </div>
                      <div className="mt-4 grid gap-2 sm:grid-cols-2">
                        {item.metrics.map((metric) => (
                          <div
                            key={metric.label}
                            className="rounded-lg border border-border/50 bg-background/60 px-3 py-2"
                          >
                            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/60">
                              {metric.label}
                            </p>
                            <p className="mt-1 text-sm font-medium">{metric.value}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              {!hasChallongeSource ? (
                <Alert className="border-dashed border-border/70 bg-background/60">
                  <CircleAlert className="h-4 w-4" />
                  <AlertTitle>Sync helpers need a link source</AlertTitle>
                  <AlertDescription>
                    Add a Challonge slug to the tournament to enable sync buttons for imported
                    data.
                  </AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab: Stages ────────────────────────────────────────────────── */}
        <TabsContent value="setup" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] items-start">
            <Card className="border-border/40">
              <CardContent className="pt-4">
                <StageManager tournamentId={tournamentId} />
              </CardContent>
            </Card>
            <div className="flex flex-col gap-4">
              <Card className="border-border/40">
                <CardContent className="pt-4">
                  <ChallongeSyncPanel
                    tournamentId={tournamentId}
                    challongeId={tournament.challonge_id}
                  />
                </CardContent>
              </Card>
              <Card className="border-border/40">
                <CardHeader className="flex flex-row items-center justify-between gap-3 py-3 px-4">
                  <div className="flex items-center gap-2 min-w-0">
                    <MessageSquare className="size-4 text-muted-foreground shrink-0" />
                    <CardTitle className="text-sm font-semibold">Discord Sync</CardTitle>
                  </div>
                  {canUpdateTournament && (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const ch = discordChannelQuery.data;
                          setDiscordChannelForm({
                            guild_id: ch?.guild_id ?? "",
                            channel_id: ch?.channel_id ?? "",
                            channel_name: ch?.channel_name ?? "",
                            is_active: ch?.is_active ?? true
                          });
                          setDiscordChannelDialogOpen(true);
                        }}
                      >
                        <Pencil className="size-3.5" />
                        {discordChannelQuery.data ? "Edit" : "Configure"}
                      </Button>
                      {discordChannelQuery.data && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setDiscordChannelDeleteOpen(true)}
                        >
                          <Trash2 className="size-3.5" />
                          Remove
                        </Button>
                      )}
                    </div>
                  )}
                </CardHeader>
                <CardContent>
                  {discordChannelQuery.isLoading ? (
                    <Skeleton className="h-10 w-full" />
                  ) : discordChannelQuery.data ? (
                    <div className="grid grid-cols-2 gap-3 text-[13px]">
                      <div>
                        <p className="text-[11px] text-muted-foreground/50">Guild</p>
                        <p className="font-mono text-[12px]">{discordChannelQuery.data.guild_id}</p>
                      </div>
                      <div>
                        <p className="text-[11px] text-muted-foreground/50">Channel</p>
                        <p className="font-mono text-[12px]">
                          {discordChannelQuery.data.channel_id}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] text-muted-foreground/50">Name</p>
                        <p>{discordChannelQuery.data.channel_name ?? "-"}</p>
                      </div>
                      <div>
                        <p className="text-[11px] text-muted-foreground/50">Status</p>
                        {discordChannelQuery.data.is_active ? (
                          <StatusIcon icon={Wifi} label="Active" variant="success" />
                        ) : (
                          <StatusIcon icon={WifiOff} label="Inactive" variant="muted" />
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-[13px] text-muted-foreground">
                      No Discord channel configured.
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2 items-start">
            <Card className="border-border/40">
              <CardHeader className="flex flex-row items-center justify-between gap-3 py-3 px-4">
                <div className="flex items-center gap-3 min-w-0">
                  <CardTitle className="text-sm font-semibold">Stages</CardTitle>
                  <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground/50">
                    <span>{stages.length} total</span>
                    <span>|</span>
                    <span>{stages.filter((stage) => Boolean(stage.challonge_slug)).length} linked</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className={adminDetailTableShell}>
                  <Table>
                    <TableHeader>
                      <TableRow className={adminDetailTableHeaderRow}>
                        <TableHead className={adminDetailTableHead}>Stage</TableHead>
                        <TableHead className={adminDetailTableHead}>Type</TableHead>
                        <TableHead className={adminDetailTableHead}>Challonge</TableHead>
                        <TableHead className={adminDetailTableHead}>Items</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stages.length ? (
                        stages.map((stage) => (
                          <TableRow key={stage.id} className={adminDetailTableRow}>
                            <TableCell className={`${adminDetailTableCell} font-medium`}>
                              {stage.name}
                            </TableCell>
                            <TableCell className={adminDetailTableCell}>
                              <StatusIcon
                                icon={stage.stage_type === "round_robin" || stage.stage_type === "swiss" ? LayoutGrid : Trophy}
                                label={stage.stage_type.replaceAll("_", " ")}
                                variant={stage.stage_type === "round_robin" || stage.stage_type === "swiss" ? "info" : "warning"}
                              />
                            </TableCell>
                            <TableCell className={adminDetailTableCell}>
                              {stage.challonge_slug ? (
                                <Link
                                  className="text-sm font-medium text-primary hover:underline"
                                  href={`https://challonge.com/${stage.challonge_slug}`}
                                  target="_blank"
                                >
                                  {stage.challonge_slug}
                                </Link>
                              ) : (
                                <span className="text-sm text-muted-foreground">Manual only</span>
                              )}
                            </TableCell>
                            <TableCell className={adminDetailTableCell}>
                              <span className="text-sm text-muted-foreground">{stage.items.length}</span>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow className={adminDetailTableRow}>
                          <TableCell className={adminDetailTableCell} colSpan={4}>
                            <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
                              <span>No stages configured yet. Use the stage manager below to set up the tournament flow.</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/40">
              <CardHeader className="flex flex-row items-center justify-between gap-3 py-3 px-4">
                <div className="flex items-center gap-3 min-w-0">
                  <CardTitle className="text-sm font-semibold">Teams</CardTitle>
                  <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground/50">
                    <span>{teams.length} teams</span>
                    <span>|</span>
                    <span>{tournament.participants_count ?? teams.length} participants</span>
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
                        <TableHead className={adminDetailTableHead}>Avg SR</TableHead>
                        <TableHead className={adminDetailTableHead}>Total SR</TableHead>
                        <TableHead className={adminDetailTableHead}>Players</TableHead>
                        <TableHead className={`${adminDetailTableHead} text-right`}>
                          Actions
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {teams.length ? (
                        teams.slice(0, DETAIL_TABLE_PREVIEW).map((team) => (
                          <TableRow key={team.id} className={adminDetailTableRow}>
                            <TableCell className={adminDetailTableCell}>
                              <span className="font-medium">{team.name}</span>
                            </TableCell>
                            <TableCell className={adminDetailTableCell}>
                              {team.avg_sr.toFixed(0)}
                            </TableCell>
                            <TableCell className={adminDetailTableCell}>{team.total_sr}</TableCell>
                            <TableCell className={adminDetailTableCell}>
                              {team.players.length}
                            </TableCell>
                            <TableCell className={adminDetailTableCell}>
                              <div className="flex items-center justify-end gap-2">
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
                          <TableCell className={adminDetailTableCell} colSpan={5}>
                            <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
                              <span>
                                No teams loaded for this tournament yet. Create one manually or sync
                                from Challonge if the workspace is linked.
                              </span>
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
                {teams.length > DETAIL_TABLE_PREVIEW && (
                  <div className="border-t border-border/30 px-3 py-2">
                    <Link
                      href={`/admin/teams?tournament=${tournamentId}`}
                      className="text-[12px] text-muted-foreground/60 hover:text-foreground transition-colors"
                    >
                      Show all {teams.length} teams →
                    </Link>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>


        {/* ── Tab: Teams ─────────────────────────────────────────────────── */}
        <TabsContent value="teams" className="space-y-4">
          <Card className="border-border/40">
            <CardHeader className="flex flex-row items-center justify-between gap-3 py-3 px-4">
              <div className="flex items-center gap-3 min-w-0">
                <CardTitle className="text-sm font-semibold">Teams</CardTitle>
                <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground/50">
                  <span>{teams.length} teams</span>
                  <span>·</span>
                  <span>{stages.length} stages configured</span>
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
                      <TableHead className={adminDetailTableHead}>Avg SR</TableHead>
                      <TableHead className={adminDetailTableHead}>Total SR</TableHead>
                      <TableHead className={adminDetailTableHead}>Players</TableHead>
                      <TableHead className={`${adminDetailTableHead} text-right`}>
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {teams.length ? (
                      teams.slice(0, DETAIL_TABLE_PREVIEW).map((team) => (
                        <TableRow key={team.id} className={adminDetailTableRow}>
                          <TableCell className={adminDetailTableCell}>
                            <span className="font-medium">{team.name}</span>
                          </TableCell>
                          <TableCell className={adminDetailTableCell}>
                            {team.avg_sr.toFixed(0)}
                          </TableCell>
                          <TableCell className={adminDetailTableCell}>{team.total_sr}</TableCell>
                          <TableCell className={adminDetailTableCell}>
                            {team.players.length}
                          </TableCell>
                          <TableCell className={adminDetailTableCell}>
                            <div className="flex items-center justify-end gap-2">
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
                        <TableCell className={adminDetailTableCell} colSpan={5}>
                          <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
                            <span>
                              No teams loaded for this tournament yet. Create one manually or sync
                              from Challonge if the workspace is linked.
                            </span>
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
              {teams.length > DETAIL_TABLE_PREVIEW && (
                <div className="border-t border-border/30 px-3 py-2">
                  <Link
                    href={`/admin/teams?tournament=${tournamentId}`}
                    className="text-[12px] text-muted-foreground/60 hover:text-foreground transition-colors"
                  >
                    Show all {teams.length} teams {"->"}
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab: Matches & Standings ────────────────────────────────────── */}
        <TabsContent value="matches" className="space-y-4">
          {/* ── Encounters + Standings ──────────────────────────────────────────── */}
          <div className="grid gap-4 xl:grid-cols-2 items-start">
            <Card className="border-border/40">
              <CardHeader className="flex flex-row items-center justify-between gap-3 py-3 px-4">
                <div className="flex items-center gap-3 min-w-0">
                  <CardTitle className="text-sm font-semibold">Encounters</CardTitle>
                  <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground/50">
                    <span>{encounters.length} encounters</span>
                    <span>·</span>
                    <span>{completedEncounterCount} completed</span>
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
                        <TableHead className={adminDetailTableHead}>Stage</TableHead>
                        <TableHead className={adminDetailTableHead}>Round</TableHead>
                        <TableHead className={adminDetailTableHead}>Score</TableHead>
                        <TableHead className={adminDetailTableHead}>Status</TableHead>
                        <TableHead className={adminDetailTableHead}>Logs</TableHead>
                        <TableHead className={`${adminDetailTableHead} text-right`}>
                          Actions
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {encounters.length ? (
                        encounters.slice(0, DETAIL_TABLE_PREVIEW).map((encounter) => (
                          <TableRow key={encounter.id} className={adminDetailTableRow}>
                            <TableCell className={adminDetailTableCell}>
                              <div className="space-y-1">
                                <span className="font-medium">{encounter.name}</span>
                                <p className="text-sm text-muted-foreground">
                                  {encounter.home_team?.name ?? "TBD"} vs{" "}
                                  {encounter.away_team?.name ?? "TBD"}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell className={adminDetailTableCell}>
                              {getEncounterStageLabel(encounter)}
                            </TableCell>
                            <TableCell className={adminDetailTableCell}>
                              {encounter.round}
                            </TableCell>
                            <TableCell className={adminDetailTableCell}>
                              {encounter.score.home} - {encounter.score.away}
                            </TableCell>
                            <TableCell className={adminDetailTableCell}>
                              {(() => {
                                const s = encounter.status?.toUpperCase() ?? "";
                                if (s === "COMPLETED")
                                  return (
                                    <StatusIcon
                                      icon={CheckCircle}
                                      label="Completed"
                                      variant="success"
                                    />
                                  );
                                if (s === "PENDING")
                                  return (
                                    <StatusIcon icon={Clock} label="Pending" variant="warning" />
                                  );
                                return (
                                  <StatusIcon
                                    icon={CircleAlert}
                                    label={s ? s.charAt(0) + s.slice(1).toLowerCase() : "Unknown"}
                                    variant="muted"
                                  />
                                );
                              })()}
                            </TableCell>
                            <TableCell className={adminDetailTableCell}>
                              {encounter.has_logs ? (
                                <StatusIcon icon={FileCheck2} label="Available" variant="success" />
                              ) : (
                                <StatusIcon icon={FileX2} label="Missing" variant="muted" />
                              )}
                            </TableCell>
                            <TableCell className={adminDetailTableCell}>
                              <div className="flex items-center justify-end gap-2">
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
                                No encounters available yet. Add at least two teams before creating
                                the first encounter.
                              </span>
                              <div className="flex flex-wrap gap-2">
                                {canSyncEncounters ? (
                                  <Button
                                    variant="outline"
                                    onClick={() => syncEncountersMutation.mutate()}
                                    disabled={
                                      syncEncountersMutation.isPending || !hasChallongeSource
                                    }
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
                {encounters.length > DETAIL_TABLE_PREVIEW && (
                  <div className="border-t border-border/30 px-3 py-2">
                    <Link
                      href={`/admin/encounters?tournament=${tournamentId}`}
                      className="text-[12px] text-muted-foreground/60 hover:text-foreground transition-colors"
                    >
                      Show all {encounters.length} encounters →
                    </Link>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── Standings ────────────────────────────────────────────────────────── */}
            <Card className="border-border/40">
              <CardHeader className="flex flex-row items-center justify-between gap-3 py-3 px-4">
                <div className="flex items-center gap-3 min-w-0">
                  <CardTitle className="text-sm font-semibold">Standings</CardTitle>
                  <span className="text-[12px] text-muted-foreground/50">
                    {standings.length} standings
                  </span>
                </div>
                <div className="flex gap-2">
                  {standings.length > DETAIL_TABLE_PREVIEW ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1.5 text-xs text-muted-foreground"
                      onClick={() => setStandingsExpanded((prev) => !prev)}
                    >
                      {standingsExpanded ? (
                        <ChevronsDownUp className="size-3.5" />
                      ) : (
                        <ChevronsUpDown className="size-3.5" />
                      )}
                      {standingsExpanded ? "Collapse" : "Expand all"}
                    </Button>
                  ) : null}
                  {canRecalculateStandings && standings.length === 0 ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => calculateStandingsMutation.mutate()}
                      disabled={calculateStandingsMutation.isPending || !canManageStandingsNow}
                    >
                      <RefreshCw className="size-3.5" /> Calculate
                    </Button>
                  ) : null}
                  {canRecalculateStandings && standings.length > 0 ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => recalculateStandingsMutation.mutate()}
                      disabled={recalculateStandingsMutation.isPending || !canManageStandingsNow}
                    >
                      <RefreshCw className="size-3.5" /> Recalculate
                    </Button>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent>
                {(() => {
                  const standingGroups = Array.from(
                    new Map(
                      standings.map((standing) => [
                        getStandingScopeKey(standing),
                        {
                          id: getStandingScopeKey(standing),
                          name: getStandingScopeLabel(standing),
                          stageOrder: standing.stage?.order ?? Number.MAX_SAFE_INTEGER,
                          itemOrder: standing.stage_item?.order ?? Number.MAX_SAFE_INTEGER,
                        },
                      ])
                    ).values()
                  ).sort(
                    (a, b) =>
                      a.stageOrder - b.stageOrder ||
                      a.itemOrder - b.itemOrder ||
                      a.name.localeCompare(b.name)
                  );
                  const baseFiltered =
                    standingsGroupFilter === "all"
                      ? standings
                      : standings.filter(
                          (standing) => getStandingScopeKey(standing) === standingsGroupFilter
                        );

                  const sortedStandings = standingsSort
                    ? [...baseFiltered].sort((a, b) => {
                        const { key, dir } = standingsSort;
                        let cmp = 0;
                        switch (key) {
                          case "position":
                            cmp = a.position - b.position;
                            break;
                          case "team":
                            cmp = (a.team?.name ?? "").localeCompare(b.team?.name ?? "");
                            break;
                          case "group":
                            cmp = getStandingScopeLabel(a).localeCompare(getStandingScopeLabel(b));
                            break;
                          case "points":
                            cmp = a.points - b.points;
                            break;
                          case "win":
                            cmp = a.win - b.win;
                            break;
                          case "draw":
                            cmp = a.draw - b.draw;
                            break;
                          case "lose":
                            cmp = a.lose - b.lose;
                            break;
                        }
                        return dir === "asc" ? cmp : -cmp;
                      })
                    : baseFiltered;

                  const visibleStandings = standingsExpanded
                    ? sortedStandings
                    : sortedStandings.slice(0, DETAIL_TABLE_PREVIEW);
                  const hasMoreStandings = sortedStandings.length > DETAIL_TABLE_PREVIEW;

                  function toggleSort(key: string) {
                    setStandingsSort((prev) => {
                      if (prev?.key === key) {
                        return prev.dir === "asc" ? { key, dir: "desc" } : null;
                      }
                      return { key, dir: "asc" };
                    });
                  }

                  function SortIcon({ col }: { col: string }) {
                    if (standingsSort?.key !== col)
                      return <ArrowUpDown className="size-3 opacity-40" />;
                    return standingsSort.dir === "asc" ? (
                      <ArrowUp className="size-3" />
                    ) : (
                      <ArrowDown className="size-3" />
                    );
                  }

                  return (
                    <>
                      {standingGroups.length > 1 ? (
                        <div className="flex items-center gap-1.5 pb-3 flex-wrap">
                          <Button
                            variant={standingsGroupFilter === "all" ? "secondary" : "ghost"}
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setStandingsGroupFilter("all")}
                          >
                            All
                          </Button>
                          {standingGroups.map((group) => (
                            <Button
                              key={group.id}
                              variant={standingsGroupFilter === group.id ? "secondary" : "ghost"}
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => setStandingsGroupFilter(group.id)}
                            >
                              {group.name}
                            </Button>
                          ))}
                        </div>
                      ) : null}
                      <div className={adminDetailTableShell}>
                        <Table>
                          <TableHeader>
                            <TableRow className={adminDetailTableHeaderRow}>
                              {(
                                [
                                  ["position", "Pos"],
                                  ["team", "Team"],
                                  ["group", "Stage"],
                                  ["points", "Pts"],
                                  ["win", "W"],
                                  ["draw", "D"],
                                  ["lose", "L"]
                                ] as const
                              ).map(([key, label]) => (
                                <TableHead
                                  key={key}
                                  className={`${adminDetailTableHead} cursor-pointer select-none`}
                                  onClick={() => toggleSort(key)}
                                >
                                  <div className="flex items-center gap-1">
                                    {label}
                                    <SortIcon col={key} />
                                  </div>
                                </TableHead>
                              ))}
                              <TableHead className={`${adminDetailTableHead} text-right`}>
                                Actions
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {visibleStandings.length ? (
                              visibleStandings.map((standing) => (
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
                                  <TableCell className={adminDetailTableCell}>
                                    {getStandingScopeLabel(standing)}
                                  </TableCell>
                                  <TableCell className={adminDetailTableCell}>
                                    {standing.points}
                                  </TableCell>
                                  <TableCell className={adminDetailTableCell}>
                                    {standing.win}
                                  </TableCell>
                                  <TableCell className={adminDetailTableCell}>
                                    {standing.draw}
                                  </TableCell>
                                  <TableCell className={adminDetailTableCell}>
                                    {standing.lose}
                                  </TableCell>
                                  <TableCell className={adminDetailTableCell}>
                                    <div className="flex items-center justify-end gap-2">
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
                                <TableCell className={adminDetailTableCell} colSpan={8}>
                                  <p className="text-sm text-muted-foreground py-2">
                                    No standings yet. Calculate after completing encounters.
                                  </p>
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </div>
                      {!standingsExpanded && hasMoreStandings && (
                        <div className="border-t border-border/30 px-3 py-2">
                          <Link
                            href={`/admin/standings?tournament=${tournamentId}`}
                            className="text-[12px] text-muted-foreground/60 hover:text-foreground transition-colors"
                          >
                            Show all {sortedStandings.length} standings →
                          </Link>
                        </div>
                      )}
                    </>
                  );
                })()}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Tab: Logs ──────────────────────────────────────────────────── */}
        <TabsContent value="logs" className="space-y-4">
          <Card className="border-border/40">
            <CardHeader className="flex flex-row items-center justify-between gap-3 py-3 px-4">
              <div className="flex items-center gap-2 min-w-0">
                <History className="size-4 text-muted-foreground shrink-0" />
                <CardTitle className="text-sm font-semibold">Log Processing History</CardTitle>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  disabled={processAllLogsMutation.isPending}
                  onClick={() => processAllLogsMutation.mutate()}
                >
                  {processAllLogsMutation.isPending ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <FolderInput className="size-3" />
                  )}
                  Process All S3 Logs
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => logHistoryQuery.refetch()}
                  disabled={logHistoryQuery.isFetching}
                >
                  <RefreshCw
                    className={`size-3.5 ${logHistoryQuery.isFetching ? "animate-spin" : ""}`}
                  />
                </Button>
              </div>
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
                        <TableHead className={adminDetailTableHead}></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logHistoryQuery.data.items.slice(0, DETAIL_TABLE_PREVIEW).map((record) => {
                        const duration =
                          record.started_at && record.finished_at
                            ? `${((new Date(record.finished_at).getTime() - new Date(record.started_at).getTime()) / 1000).toFixed(1)}s`
                            : record.status === "processing"
                              ? "In progress…"
                              : "—";
                        const statusIconMap: Record<
                          string,
                          {
                            icon: typeof CheckCircle;
                            variant: "success" | "info" | "muted" | "destructive" | "warning";
                          }
                        > = {
                          pending: { icon: Clock, variant: "muted" },
                          processing: { icon: Loader2, variant: "info" },
                          done: { icon: CheckCircle, variant: "success" },
                          failed: { icon: XCircle, variant: "destructive" }
                        };
                        const statusInfo = statusIconMap[record.status] ?? {
                          icon: CircleAlert,
                          variant: "muted" as const
                        };
                        return (
                          <TableRow key={record.id} className={adminDetailTableRow}>
                            <TableCell className={adminDetailTableCell}>
                              <span className="font-mono text-xs">
                                {record.filename.split("/").at(-1)}
                              </span>
                              {record.error_message && (
                                <p className="mt-1 text-xs text-destructive line-clamp-1">
                                  {record.error_message}
                                </p>
                              )}
                            </TableCell>
                            <TableCell className={adminDetailTableCell}>
                              <StatusIcon
                                icon={statusInfo.icon}
                                label={record.status}
                                variant={statusInfo.variant}
                              />
                            </TableCell>
                            <TableCell className={adminDetailTableCell}>
                              <span className="capitalize text-muted-foreground text-sm">
                                {record.source}
                              </span>
                            </TableCell>
                            <TableCell className={adminDetailTableCell}>
                              {record.uploader_name ? (
                                <span className="text-sm">{record.uploader_name}</span>
                              ) : (
                                <span className="text-muted-foreground text-sm">—</span>
                              )}
                            </TableCell>
                            <TableCell className={adminDetailTableCell}>
                              <span className="text-sm">
                                {new Date(record.created_at).toLocaleString()}
                              </span>
                            </TableCell>
                            <TableCell className={adminDetailTableCell}>
                              <span className="text-sm text-muted-foreground">{duration}</span>
                            </TableCell>
                            <TableCell className={adminDetailTableCell}>
                              {record.status === "failed" && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label="Retry processing"
                                  disabled={
                                    retryLogMutation.isPending &&
                                    retryLogMutation.variables === record.id
                                  }
                                  onClick={() => retryLogMutation.mutate(record.id)}
                                >
                                  <RotateCcw className="h-4 w-4" />
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
              {logHistoryQuery.data && logHistoryQuery.data.items.length > DETAIL_TABLE_PREVIEW && (
                <div className="border-t border-border/30 px-3 py-2">
                  <span className="text-[12px] text-muted-foreground/50">
                    Showing {DETAIL_TABLE_PREVIEW} of {logHistoryQuery.data.items.length} logs
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Dialogs (outside tabs, always mounted) ───────────────────────── */}

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
        errorMessage={
          saveDiscordChannelMutation.isError ? saveDiscordChannelMutation.error.message : undefined
        }
        isDirty={true}
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="discord-guild-id">Guild ID</Label>
            <Input
              id="discord-guild-id"
              type="text"
              inputMode="numeric"
              value={discordChannelForm.guild_id}
              onChange={(e) =>
                setDiscordChannelForm((c) => ({
                  ...c,
                  guild_id: e.target.value.replace(/\D/g, "")
                }))
              }
              placeholder="e.g. 123456789012345678"
            />
          </div>
          <div>
            <Label htmlFor="discord-channel-id">Channel ID</Label>
            <Input
              id="discord-channel-id"
              type="text"
              inputMode="numeric"
              value={discordChannelForm.channel_id}
              onChange={(e) =>
                setDiscordChannelForm((c) => ({
                  ...c,
                  channel_id: e.target.value.replace(/\D/g, "")
                }))
              }
              placeholder="e.g. 987654321098765432"
            />
          </div>
          <div>
            <Label htmlFor="discord-channel-name">Channel Name (optional)</Label>
            <Input
              id="discord-channel-name"
              value={discordChannelForm.channel_name ?? ""}
              onChange={(e) =>
                setDiscordChannelForm((c) => ({ ...c, channel_name: e.target.value || null }))
              }
              placeholder="e.g. #match-logs"
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="discord-is-active"
              checked={discordChannelForm.is_active}
              onCheckedChange={(checked) =>
                setDiscordChannelForm((c) => ({ ...c, is_active: Boolean(checked) }))
              }
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
        errorMessage={
          updateTournamentMutation.isError ? updateTournamentMutation.error.message : undefined
        }
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
                  number: event.target.value ? Number(event.target.value) : null
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
                  description: event.target.value
                }))
              }
            />
          </div>

          <div>
            <Label htmlFor="workspace-tournament-challonge">Challonge URL or Slug</Label>
            <Input
              id="workspace-tournament-challonge"
              placeholder="e.g. my-tournament or https://challonge.com/my-tournament"
              value={tournamentFormData.challonge_slug}
              onChange={(event) =>
                setTournamentFormData((current) => ({
                  ...current,
                  challonge_slug: event.target.value
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
                  is_league: checked === true
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
                  is_finished: checked === true
                }))
              }
            />
            <Label htmlFor="workspace-tournament-is-finished" className="cursor-pointer">
              Mark tournament as finished
            </Label>
          </div>

          <Field>
            <FieldLabel htmlFor="workspace-date-range">Date Range</FieldLabel>
            <DateRangePicker
              id="workspace-date-range"
              startDate={tournamentFormData.start_date}
              endDate={tournamentFormData.end_date}
              onChange={(start, end) =>
                setTournamentFormData((current) => ({
                  ...current,
                  start_date: start,
                  end_date: end
                }))
              }
            />
          </Field>

          <div>
            <Label htmlFor="workspace-division-grid-version">Division Grid Version</Label>
            <Select
              value={tournamentFormData.division_grid_version_id?.toString() ?? "none"}
              onValueChange={(value) =>
                setTournamentFormData((current) => ({
                  ...current,
                  division_grid_version_id: value === "none" ? null : Number(value)
                }))
              }
            >
              <SelectTrigger id="workspace-division-grid-version">
                <SelectValue
                  placeholder={
                    divisionGridsQuery.isLoading ? "Loading division grids..." : "Select version"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Workspace default</SelectItem>
                {divisionGridVersions.map((version) => (
                  <SelectItem key={version.id} value={version.id.toString()}>
                    {version.label} (v{version.version}, {version.status})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="border-t border-border/40 pt-4 mt-4">
            <p className="text-sm font-medium mb-3">Scoring Points</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="workspace-win-points">Win</Label>
                <Input
                  id="workspace-win-points"
                  type="number"
                  step="0.5"
                  value={tournamentFormData.win_points}
                  onChange={(e) =>
                    setTournamentFormData((c) => ({ ...c, win_points: Number(e.target.value) }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="workspace-draw-points">Draw</Label>
                <Input
                  id="workspace-draw-points"
                  type="number"
                  step="0.5"
                  value={tournamentFormData.draw_points}
                  onChange={(e) =>
                    setTournamentFormData((c) => ({ ...c, draw_points: Number(e.target.value) }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="workspace-loss-points">Loss</Label>
                <Input
                  id="workspace-loss-points"
                  type="number"
                  step="0.5"
                  value={tournamentFormData.loss_points}
                  onChange={(e) =>
                    setTournamentFormData((c) => ({ ...c, loss_points: Number(e.target.value) }))
                  }
                />
              </div>
            </div>
          </div>

          <div className="border-t border-border/40 pt-4 mt-4">
            <p className="text-sm font-medium mb-3">Registration Period</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="workspace-reg-opens">Opens at</Label>
                <Input
                  id="workspace-reg-opens"
                  type="datetime-local"
                  value={tournamentFormData.registration_opens_at}
                  onChange={(e) =>
                    setTournamentFormData((c) => ({ ...c, registration_opens_at: e.target.value }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="workspace-reg-closes">Closes at</Label>
                <Input
                  id="workspace-reg-closes"
                  type="datetime-local"
                  value={tournamentFormData.registration_closes_at}
                  onChange={(e) =>
                    setTournamentFormData((c) => ({ ...c, registration_closes_at: e.target.value }))
                  }
                />
              </div>
            </div>
          </div>

          <div className="border-t border-border/40 pt-4 mt-4">
            <p className="text-sm font-medium mb-3">Check-in Period</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="workspace-checkin-opens">Opens at</Label>
                <Input
                  id="workspace-checkin-opens"
                  type="datetime-local"
                  value={tournamentFormData.check_in_opens_at}
                  onChange={(e) =>
                    setTournamentFormData((c) => ({ ...c, check_in_opens_at: e.target.value }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="workspace-checkin-closes">Closes at</Label>
                <Input
                  id="workspace-checkin-closes"
                  type="datetime-local"
                  value={tournamentFormData.check_in_closes_at}
                  onChange={(e) =>
                    setTournamentFormData((c) => ({ ...c, check_in_closes_at: e.target.value }))
                  }
                />
              </div>
            </div>
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
                  captain_id: event.target.value ? Number(event.target.value) : 0
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
                    avg_sr: event.target.value ? Number(event.target.value) : 0
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
                    total_sr: event.target.value ? Number(event.target.value) : 0
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
            <Label htmlFor="workspace-encounter-stage">Stage</Label>
            <Select
              value={encounterFormData.stage_id?.toString() ?? ""}
              onValueChange={(value) => {
                const stage = stages.find((entry) => entry.id === Number(value)) ?? null;
                setEncounterFormData((current) => ({
                  ...current,
                  stage_id: stage?.id ?? null,
                  stage_item_id: stage?.items[0]?.id ?? null
                }));
              }}
            >
              <SelectTrigger id="workspace-encounter-stage">
                <SelectValue placeholder="Select stage" />
              </SelectTrigger>
              <SelectContent>
                {stages.map((stage) => (
                  <SelectItem key={stage.id} value={stage.id.toString()}>
                    {stage.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="workspace-encounter-stage-item">Stage Item</Label>
            <Select
              value={encounterFormData.stage_item_id?.toString() ?? "none"}
              onValueChange={(value) =>
                setEncounterFormData((current) => {
                  const nextStageItemId = value === "none" ? null : Number(value);
                  const nextStageId =
                    nextStageItemId != null
                      ? stages.find((stage) =>
                          stage.items.some((item) => item.id === nextStageItemId)
                        )?.id ?? current.stage_id
                      : current.stage_id;
                  return {
                    ...current,
                    stage_id: nextStageId,
                    stage_item_id: nextStageItemId
                  };
                })
              }
            >
              <SelectTrigger id="workspace-encounter-stage-item">
                <SelectValue placeholder="Select stage item" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No stage item</SelectItem>
                {stages
                  .filter((stage) => stage.id === encounterFormData.stage_id)
                  .flatMap((stage) => stage.items)
                  .map((item) => (
                    <SelectItem key={item.id} value={item.id.toString()}>
                      {item.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="workspace-encounter-home">Home Team</Label>
              <Select
                value={
                  encounterFormData.home_team_id ? encounterFormData.home_team_id.toString() : ""
                }
                onValueChange={(value) =>
                  setEncounterFormData((current) => ({
                    ...current,
                    home_team_id: Number(value)
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
                value={
                  encounterFormData.away_team_id ? encounterFormData.away_team_id.toString() : ""
                }
                onValueChange={(value) =>
                  setEncounterFormData((current) => ({
                    ...current,
                    away_team_id: Number(value)
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
                  round: event.target.value ? Number(event.target.value) : 1
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
                    home_score: event.target.value ? Number(event.target.value) : 0
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
                    away_score: event.target.value ? Number(event.target.value) : 0
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
        errorMessage={
          updateStandingMutation.isError ? updateStandingMutation.error.message : undefined
        }
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
                  position: event.target.value ? Number(event.target.value) : 0
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
                  points: event.target.value ? Number(event.target.value) : 0
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
                  win: event.target.value ? Number(event.target.value) : 0
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
                  draw: event.target.value ? Number(event.target.value) : 0
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
                  lose: event.target.value ? Number(event.target.value) : 0
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
          "Standings rows"
        ]}
        isDeleting={deleteTournamentMutation.isPending}
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
        cascadeInfo={[
          "Players in this team",
          "Related encounter references",
          "Stored standings rows"
        ]}
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
