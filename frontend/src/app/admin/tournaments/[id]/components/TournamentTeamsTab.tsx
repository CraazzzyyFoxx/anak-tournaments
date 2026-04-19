"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  Check,
  ChevronsUpDown,
  FolderInput,
  Loader2,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  UserPlus,
} from "lucide-react";

import { AdminDetailTableShell, getAdminDetailTableStyles } from "@/components/admin/AdminDetailTable";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { EntityFormDialog } from "@/components/admin/EntityFormDialog";
import { StatusIcon } from "@/components/admin/StatusIcon";
import { UserSearchCombobox } from "@/components/admin/UserSearchCombobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { hasUnsavedChanges } from "@/lib/form-change";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import adminService from "@/services/admin.service";
import balancerAdminService from "@/services/balancer-admin.service";
import type {
  PlayerCreateInput,
  PlayerSubRole,
  PlayerUpdateInput,
  TeamUpdateInput,
} from "@/types/admin.types";
import type { Team } from "@/types/team.types";
import type { MinimizedUser } from "@/types/user.types";
import { formatSubRoleLabel } from "@/utils/player";
import {
  TOURNAMENT_DETAIL_PREVIEW_LIMIT,
  getEmptyTeamForm,
  getTeamForm,
  type TeamFormState,
} from "./tournamentWorkspace.helpers";
import { invalidateTournamentWorkspace } from "./tournamentWorkspace.queryKeys";
import {
  buildCaptainOptions,
  buildRosterDraftTree,
  buildRosterInitialSnapshot,
  createRosterDraftFromTeam,
  normalizePlayerRole,
  removeRosterDraftPlayer,
  type PlayerRoleOption,
  type TeamRosterDraftPlayer,
} from "./tournamentRoster.helpers";

interface TournamentTeamsTabProps {
  tournamentId: number;
  workspaceId: number | null;
  teams: Team[];
  stagesCount: number;
  hasChallongeSource: boolean;
  canCreateTeam: boolean;
  canUpdateTeam: boolean;
  canDeleteTeam: boolean;
  canImportTeams: boolean;
  canCreatePlayer: boolean;
  canUpdatePlayer: boolean;
  canDeletePlayer: boolean;
}

interface TeamNumberInputProps {
  id: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
}

interface PlayerOption {
  value: string;
  label: string;
  meta?: string;
}

interface SearchableSelectProps {
  value: string;
  options: PlayerOption[];
  onChange: (value: string) => void;
  placeholder: string;
  searchPlaceholder: string;
  emptyMessage: string;
  disabled?: boolean;
}

type PlayerEditorFormState = {
  name: string;
  user_id: number;
  user_name: string;
  role: PlayerRoleOption;
  sub_role: string;
  rank: number;
  is_newcomer: boolean;
  is_newcomer_role: boolean;
};

type PlayerDialogState = {
  mode: "create-root" | "create-substitute" | "edit";
  targetDraftId: string;
  sourceDraftId?: string;
  parentDraftId?: string | null;
  initialState: PlayerEditorFormState;
};

function clampTeamNumber(value: number, min?: number, max?: number) {
  if (typeof min === "number" && value < min) {
    return min;
  }

  if (typeof max === "number" && value > max) {
    return max;
  }

  return value;
}

function normalizeTeamNumberDraft(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(1)));
}

function TeamNumberInput({
  id,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  disabled = false,
}: TeamNumberInputProps) {
  const [draft, setDraft] = useState(normalizeTeamNumberDraft(value));

  useEffect(() => {
    setDraft(normalizeTeamNumberDraft(value));
  }, [value]);

  const commitValue = (nextDraft: string) => {
    const nextValue = Number.parseFloat(nextDraft);

    if (Number.isNaN(nextValue)) {
      setDraft(normalizeTeamNumberDraft(value));
      return;
    }

    const clamped = clampTeamNumber(nextValue, min, max);
    setDraft(normalizeTeamNumberDraft(clamped));
    onChange(clamped);
  };

  const stepValue = (direction: -1 | 1) => {
    const nextValue = clampTeamNumber(value + step * direction, min, max);
    setDraft(normalizeTeamNumberDraft(nextValue));
    onChange(nextValue);
  };

  return (
    <div className="flex h-10 overflow-hidden rounded-md border border-input bg-background/80 shadow-sm focus-within:ring-1 focus-within:ring-ring">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-full w-10 shrink-0 rounded-r-none border-r"
        onClick={() => stepValue(-1)}
        disabled={disabled || (typeof min === "number" && value <= min)}
        aria-label={`Decrease ${id}`}
      >
        <Minus className="h-3.5 w-3.5" />
      </Button>
      <div className="flex min-w-0 flex-1 items-center">
        <Input
          id={id}
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(event) => {
            const nextDraft = event.target.value.replace(/[^\d.-]/g, "");
            setDraft(nextDraft);

            if (nextDraft && nextDraft !== "-" && nextDraft !== "." && nextDraft !== "-.") {
              commitValue(nextDraft);
            }
          }}
          onBlur={() => commitValue(draft)}
          disabled={disabled}
          className="h-full rounded-none border-0 bg-transparent text-center shadow-none focus-visible:ring-0"
        />
        {suffix ? (
          <span className="shrink-0 pr-3 text-xs font-medium text-muted-foreground">{suffix}</span>
        ) : null}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-full w-10 shrink-0 rounded-l-none border-l"
        onClick={() => stepValue(1)}
        disabled={disabled || (typeof max === "number" && value >= max)}
        aria-label={`Increase ${id}`}
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function SearchableSelect({
  value,
  options,
  onChange,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  disabled = false,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const selected = options.find((option) => option.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="h-10 w-full justify-between border-border/60 bg-background/80 font-normal hover:bg-background/90"
        >
          <span className="truncate" title={selected?.label ?? placeholder}>
            {selected?.label ?? placeholder}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={`${option.label} ${option.meta ?? ""} ${option.value}`}
                  onSelect={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                    <span className="truncate">{option.label}</span>
                    {option.meta ? (
                      <span className="shrink-0 text-xs text-muted-foreground">{option.meta}</span>
                    ) : null}
                  </div>
                  <Check className={cn("ml-2 h-4 w-4", value === option.value ? "opacity-100" : "opacity-0")} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const PLAYER_ROLE_OPTIONS: PlayerRoleOption[] = ["Tank", "Damage", "Support"];

function RoleOptionContent({ role }: { role: PlayerRoleOption }) {
  return (
    <div className="flex items-center gap-2">
      <span>{role}</span>
    </div>
  );
}

function filterSubRoleOptions(subRoles: PlayerSubRole[] | undefined, role: PlayerRoleOption) {
  const catalogRole = role === "Tank" ? "tank" : role === "Support" ? "support" : "damage";
  return (subRoles ?? []).filter((subRole) => subRole.role === catalogRole);
}

function getPlayerEditorState(draft: TeamRosterDraftPlayer | null): PlayerEditorFormState {
  if (!draft) {
    return {
      name: "",
      user_id: 0,
      user_name: "",
      role: "Damage",
      sub_role: "",
      rank: 0,
      is_newcomer: false,
      is_newcomer_role: false,
    };
  }

  return {
    name: draft.name,
    user_id: draft.user_id,
    user_name: draft.user_name,
    role: draft.role,
    sub_role: draft.sub_role,
    rank: draft.rank,
    is_newcomer: draft.is_newcomer,
    is_newcomer_role: draft.is_newcomer_role,
  };
}

function resolveRelatedPlayerId(
  draft: TeamRosterDraftPlayer,
  createdIdsByDraftId: Map<string, number>,
  rosterByDraftId: Map<string, TeamRosterDraftPlayer>
) {
  if (!draft.is_substitution) {
    return null;
  }

  if (draft.related_draft_id) {
    const parentDraft = rosterByDraftId.get(draft.related_draft_id);
    if (parentDraft?.player_id != null) {
      return parentDraft.player_id;
    }
    const createdId = createdIdsByDraftId.get(draft.related_draft_id);
    if (createdId != null) {
      return createdId;
    }
  }

  return draft.related_player_id ?? null;
}

function buildPlayerCreatePayload(
  draft: TeamRosterDraftPlayer,
  input: {
    teamId: number;
    tournamentId: number;
    relatedPlayerId: number | null;
  }
): PlayerCreateInput {
  return {
    name: draft.name.trim(),
    user_id: draft.user_id,
    team_id: input.teamId,
    tournament_id: input.tournamentId,
    role: draft.role,
    rank: draft.rank,
    sub_role: draft.sub_role || null,
    is_newcomer: draft.is_newcomer,
    is_newcomer_role: draft.is_newcomer_role,
    is_substitution: draft.is_substitution,
    related_player_id: draft.is_substitution ? input.relatedPlayerId : null,
  };
}

function buildPlayerUpdatePayload(
  current: TeamRosterDraftPlayer,
  initial: TeamRosterDraftPlayer,
  relatedPlayerId: number | null
): PlayerUpdateInput | null {
  const payload: PlayerUpdateInput = {
    name: current.name.trim(),
    role: current.role,
    rank: current.rank,
    sub_role: current.sub_role || null,
    is_newcomer: current.is_newcomer,
    is_newcomer_role: current.is_newcomer_role,
    is_substitution: current.is_substitution,
    related_player_id: current.is_substitution ? relatedPlayerId : null,
  };

  const initialComparable = {
    name: initial.name.trim(),
    role: initial.role,
    rank: initial.rank,
    sub_role: initial.sub_role || null,
    is_newcomer: initial.is_newcomer,
    is_newcomer_role: initial.is_newcomer_role,
    is_substitution: initial.is_substitution,
    related_player_id: initial.is_substitution ? initial.related_player_id : null,
  };

  return hasUnsavedChanges(payload, initialComparable) ? payload : null;
}

export function TournamentTeamsTab({
  tournamentId,
  workspaceId,
  teams,
  stagesCount,
  hasChallongeSource,
  canCreateTeam,
  canUpdateTeam,
  canDeleteTeam,
  canImportTeams,
  canCreatePlayer,
  canUpdatePlayer,
  canDeletePlayer,
}: TournamentTeamsTabProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const tableStyles = getAdminDetailTableStyles("compact");
  const importTeamsFileRef = useRef<HTMLInputElement>(null);
  const draftCounterRef = useRef(0);

  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [teamFormData, setTeamFormData] = useState<TeamFormState>(getEmptyTeamForm());
  const [rosterDraftPlayers, setRosterDraftPlayers] = useState<TeamRosterDraftPlayer[]>([]);
  const [deletedExistingPlayerIds, setDeletedExistingPlayerIds] = useState<number[]>([]);
  const [teamFormError, setTeamFormError] = useState<string | undefined>();
  const [teamPendingDelete, setTeamPendingDelete] = useState<Team | null>(null);
  const [playerDialogOpen, setPlayerDialogOpen] = useState(false);
  const [playerDialogState, setPlayerDialogState] = useState<PlayerDialogState | null>(null);
  const [playerFormData, setPlayerFormData] = useState<PlayerEditorFormState>(getPlayerEditorState(null));
  const [playerFormError, setPlayerFormError] = useState<string | undefined>();

  const canManageRoster = canCreatePlayer || canUpdatePlayer || canDeletePlayer;
  const canOpenCreateDialog = canCreateTeam && canCreatePlayer;
  const canOpenEditDialog = canUpdateTeam || canManageRoster;

  const { data: playerSubRoles } = useQuery({
    queryKey: ["admin", "player-sub-roles", workspaceId],
    queryFn: () => adminService.getPlayerSubRoles({ workspace_id: workspaceId! }),
    enabled: Boolean(workspaceId && teamDialogOpen),
  });

  const rosterByDraftId = useMemo(
    () => new Map(rosterDraftPlayers.map((player) => [player.draft_id, player])),
    [rosterDraftPlayers]
  );
  const rosterTree = useMemo(
    () => buildRosterDraftTree(rosterDraftPlayers),
    [rosterDraftPlayers]
  );
  const captainOptions = useMemo(
    () => buildCaptainOptions(rosterDraftPlayers),
    [rosterDraftPlayers]
  );

  const resetPlayerDialog = () => {
    setPlayerDialogOpen(false);
    setPlayerDialogState(null);
    setPlayerFormData(getPlayerEditorState(null));
    setPlayerFormError(undefined);
  };

  const resetTeamDialog = () => {
    setTeamDialogOpen(false);
    setEditingTeam(null);
    setTeamFormData(getEmptyTeamForm());
    setRosterDraftPlayers([]);
    setDeletedExistingPlayerIds([]);
    setTeamFormError(undefined);
    saveTeamMutation.reset();
    resetPlayerDialog();
  };

  const createNextDraftId = () => {
    draftCounterRef.current += 1;
    return `new:${draftCounterRef.current}`;
  };

  const syncCaptainSelection = (nextRoster: TeamRosterDraftPlayer[]) => {
    const nextOptions = buildCaptainOptions(nextRoster);
    setTeamFormData((current) => ({
      ...current,
      captain_id: nextOptions.some((option) => option.user_id === current.captain_id) ? current.captain_id : 0,
    }));
  };

  const openPlayerCreateDialog = (parentDraft?: TeamRosterDraftPlayer) => {
    const draftId = createNextDraftId();
    const dialogState: PlayerDialogState = {
      mode: parentDraft ? "create-substitute" : "create-root",
      targetDraftId: draftId,
      parentDraftId: parentDraft?.draft_id ?? null,
      initialState: getPlayerEditorState(null),
    };

    setPlayerDialogState(dialogState);
    setPlayerFormData(dialogState.initialState);
    setPlayerFormError(undefined);
    setPlayerDialogOpen(true);
  };

  const openPlayerEditDialog = (draft: TeamRosterDraftPlayer) => {
    const dialogState: PlayerDialogState = {
      mode: "edit",
      targetDraftId: draft.draft_id,
      sourceDraftId: draft.draft_id,
      parentDraftId: draft.related_draft_id,
      initialState: getPlayerEditorState(draft),
    };

    setPlayerDialogState(dialogState);
    setPlayerFormData(dialogState.initialState);
    setPlayerFormError(undefined);
    setPlayerDialogOpen(true);
  };

  const handleRemoveRosterPlayer = (draft: TeamRosterDraftPlayer) => {
    const canDeleteDraft = draft.state === "new" ? canCreatePlayer : canDeletePlayer;
    if (!canDeleteDraft) {
      return;
    }

    const nextState = removeRosterDraftPlayer(rosterDraftPlayers, draft.draft_id);
    setRosterDraftPlayers(nextState.players);
    if (nextState.deletedExistingPlayerId != null) {
      setDeletedExistingPlayerIds((current) =>
        current.includes(nextState.deletedExistingPlayerId as number)
          ? current
          : [...current, nextState.deletedExistingPlayerId as number]
      );
    }
    syncCaptainSelection(nextState.players);
  };

  const saveTeamMutation = useMutation({
    mutationFn: async (variables: {
      mode: "create" | "update";
      teamId?: number;
      teamData: TeamFormState;
      roster: TeamRosterDraftPlayer[];
      deletedIds: number[];
      initialTeam: Team | null;
      canPatchTeam: boolean;
    }) => {
      const {
        mode,
        teamId,
        teamData,
        roster,
        deletedIds,
        initialTeam,
        canPatchTeam,
      } = variables;

      const initialByPlayerId = new Map(
        (initialTeam ? createRosterDraftFromTeam(initialTeam) : [])
          .filter((player) => player.player_id != null)
          .map((player) => [player.player_id as number, player])
      );

      let savedTeam: Team;
      let deferCaptainPatch = false;

      if (mode === "create") {
        savedTeam = await adminService.createTeam({
          name: teamData.name.trim(),
          tournament_id: tournamentId,
          captain_id: teamData.captain_id,
          avg_sr: teamData.avg_sr,
          total_sr: teamData.total_sr,
        });
      } else if (canPatchTeam) {
        const captainInExistingRoster = roster.some(
          (player) => player.state === "existing" && player.user_id === teamData.captain_id
        );
        const initialPatch: TeamUpdateInput = {
          name: teamData.name.trim(),
          avg_sr: teamData.avg_sr,
          total_sr: teamData.total_sr,
        };

        if (captainInExistingRoster) {
          initialPatch.captain_id = teamData.captain_id;
        } else {
          deferCaptainPatch = true;
        }

        savedTeam = await adminService.updateTeam(teamId!, initialPatch);
      } else {
        savedTeam = initialTeam as Team;
      }

      const rosterMap = new Map(roster.map((player) => [player.draft_id, player]));
      const createdIdsByDraftId = new Map<string, number>();

      for (const player of roster) {
        if (player.player_id != null) {
          createdIdsByDraftId.set(player.draft_id, player.player_id);
        }
      }

      const newBasePlayers = roster.filter((player) => player.state === "new" && !player.is_substitution);
      for (const draft of newBasePlayers) {
        const createdPlayer = await adminService.createPlayer(
          buildPlayerCreatePayload(draft, {
            teamId: savedTeam.id,
            tournamentId,
            relatedPlayerId: null,
          })
        );
        createdIdsByDraftId.set(draft.draft_id, createdPlayer.id);
      }

      let pendingSubstitutes = roster.filter((player) => player.state === "new" && player.is_substitution);
      while (pendingSubstitutes.length > 0) {
        const unresolved: TeamRosterDraftPlayer[] = [];
        let progressed = false;

        for (const draft of pendingSubstitutes) {
          const relatedPlayerId = resolveRelatedPlayerId(draft, createdIdsByDraftId, rosterMap);
          if (relatedPlayerId == null) {
            unresolved.push(draft);
            continue;
          }

          const createdPlayer = await adminService.createPlayer(
            buildPlayerCreatePayload(draft, {
              teamId: savedTeam.id,
              tournamentId,
              relatedPlayerId,
            })
          );
          createdIdsByDraftId.set(draft.draft_id, createdPlayer.id);
          progressed = true;
        }

        if (!progressed) {
          throw new Error("Unable to resolve substitute chain before save.");
        }

        pendingSubstitutes = unresolved;
      }

      for (const draft of roster) {
        if (draft.state !== "existing" || draft.player_id == null) {
          continue;
        }

        const initialDraft = initialByPlayerId.get(draft.player_id);
        if (!initialDraft) {
          continue;
        }

        const relatedPlayerId = resolveRelatedPlayerId(draft, createdIdsByDraftId, rosterMap);
        const payload = buildPlayerUpdatePayload(draft, initialDraft, relatedPlayerId);
        if (!payload) {
          continue;
        }

        await adminService.updatePlayer(draft.player_id, payload);
      }

      for (const playerId of deletedIds) {
        await adminService.deletePlayer(playerId);
      }

      if (mode === "update" && canPatchTeam && deferCaptainPatch) {
        await adminService.updateTeam(savedTeam.id, { captain_id: teamData.captain_id });
      }

      return savedTeam;
    },
    onSuccess: async (_data, variables) => {
      await invalidateTournamentWorkspace(queryClient, tournamentId);
      resetTeamDialog();
      toast({
        title: variables.mode === "create" ? "Team and roster created" : "Team roster updated",
      });
    },
    onError: (error: Error) => {
      setTeamFormError(error.message);
    },
  });

  const deleteTeamMutation = useMutation({
    mutationFn: (teamId: number) => adminService.deleteTeam(teamId),
    onSuccess: async () => {
      await invalidateTournamentWorkspace(queryClient, tournamentId);
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
      await invalidateTournamentWorkspace(queryClient, tournamentId);
      toast({ title: "Teams synced from Challonge" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const importTeamsMutation = useMutation({
    mutationFn: (file: File) => balancerAdminService.importTeamsFromJson(tournamentId, file),
    onSuccess: async (result) => {
      await invalidateTournamentWorkspace(queryClient, tournamentId);
      toast({ title: "Teams imported", description: `${result.imported_teams} teams created.` });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to import teams",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const openCreateTeamDialog = () => {
    setTeamFormError(undefined);
    setEditingTeam(null);
    setTeamFormData(getEmptyTeamForm());
    setRosterDraftPlayers([]);
    setDeletedExistingPlayerIds([]);
    setTeamDialogOpen(true);
  };

  const openEditTeamDialog = (team: Team) => {
    setTeamFormError(undefined);
    setEditingTeam(team);
    setTeamFormData(getTeamForm(team));
    setRosterDraftPlayers(createRosterDraftFromTeam(team));
    setDeletedExistingPlayerIds([]);
    setTeamDialogOpen(true);
  };

  const handlePlayerDialogSubmit = (event: FormEvent) => {
    event.preventDefault();

    if (!playerDialogState) {
      return;
    }

    if (!playerFormData.name.trim()) {
      setPlayerFormError("Player name is required.");
      return;
    }

    const existingDraft =
      playerDialogState.sourceDraftId != null
        ? rosterByDraftId.get(playerDialogState.sourceDraftId) ?? null
        : null;

    const requiresUser = existingDraft?.state !== "existing";
    if (requiresUser && playerFormData.user_id <= 0) {
      setPlayerFormError("Linked user is required.");
      return;
    }

    const nextDraft: TeamRosterDraftPlayer = {
      draft_id: playerDialogState.targetDraftId,
      player_id: existingDraft?.player_id ?? null,
      state: existingDraft?.state ?? "new",
      name: playerFormData.name.trim(),
      user_id: existingDraft?.state === "existing" ? existingDraft.user_id : playerFormData.user_id,
      user_name:
        existingDraft?.state === "existing"
          ? existingDraft.user_name
          : playerFormData.user_name || playerFormData.name.trim(),
      role: playerFormData.role,
      sub_role: playerFormData.sub_role,
      rank: playerFormData.rank,
      is_newcomer: playerFormData.is_newcomer,
      is_newcomer_role: playerFormData.is_newcomer_role,
      is_substitution:
        playerDialogState.mode === "create-substitute" ? true : (existingDraft?.is_substitution ?? false),
      related_player_id:
        playerDialogState.mode === "create-substitute"
          ? (playerDialogState.parentDraftId ? rosterByDraftId.get(playerDialogState.parentDraftId)?.player_id ?? null : null)
          : (existingDraft?.related_player_id ?? null),
      related_draft_id:
        playerDialogState.mode === "create-substitute"
          ? (playerDialogState.parentDraftId ?? null)
          : (existingDraft?.related_draft_id ?? null),
    };

    const nextRoster =
      playerDialogState.mode === "edit" && playerDialogState.sourceDraftId
        ? rosterDraftPlayers.map((player) =>
            player.draft_id === playerDialogState.sourceDraftId ? nextDraft : player
          )
        : [...rosterDraftPlayers, nextDraft];

    setRosterDraftPlayers(nextRoster);
    resetPlayerDialog();
  };

  const handleTeamSubmit = (event: FormEvent) => {
    event.preventDefault();

    if (!teamFormData.name.trim()) {
      setTeamFormError("Team name is required.");
      return;
    }

    if (rosterDraftPlayers.length === 0) {
      setTeamFormError("At least one roster member is required.");
      return;
    }

    if (!captainOptions.some((option) => option.user_id === teamFormData.captain_id)) {
      setTeamFormError("Captain must be selected from the current roster.");
      return;
    }

    if (!editingTeam && !canCreateTeam) {
      setTeamFormError("You do not have permission to create teams.");
      return;
    }

    if (editingTeam && !canUpdateTeam && !canManageRoster) {
      setTeamFormError("You do not have permission to update this team.");
      return;
    }

    saveTeamMutation.mutate({
      mode: editingTeam ? "update" : "create",
      teamId: editingTeam?.id,
      teamData: teamFormData,
      roster: rosterDraftPlayers,
      deletedIds: deletedExistingPlayerIds,
      initialTeam: editingTeam,
      canPatchTeam: editingTeam ? canUpdateTeam : true,
    });
  };

  const rosterSnapshot = buildRosterInitialSnapshot(editingTeam);
  const isTeamDirty =
    teamDialogOpen &&
    hasUnsavedChanges(
      {
        team: teamFormData,
        roster: rosterDraftPlayers,
        deletedIds: deletedExistingPlayerIds,
      },
      {
        team: rosterSnapshot.team,
        roster: rosterSnapshot.roster,
        deletedIds: [] as number[],
      }
    );

  const playerDialogDraft = playerDialogState?.sourceDraftId
    ? rosterByDraftId.get(playerDialogState.sourceDraftId) ?? null
    : null;
  const playerDialogInitial = playerDialogState?.initialState ?? getPlayerEditorState(null);
  const isPlayerDirty = playerDialogOpen && hasUnsavedChanges(playerFormData, playerDialogInitial);
  const playerSubRoleOptions = filterSubRoleOptions(playerSubRoles, playerFormData.role);
  const playerSubRoleSelectOptions = [
    { value: "none", label: "No sub-role" },
    ...playerSubRoleOptions.map((subRole) => ({
      value: subRole.slug,
      label: subRole.label,
      meta: subRole.slug,
    })),
  ];

  const renderRosterNodes = (nodes: ReturnType<typeof buildRosterDraftTree>, depth = 0): ReactNode =>
    nodes.map((node) => {
      const draft = node.player;
      const canEditDraft = draft.state === "new" ? canCreatePlayer : canUpdatePlayer;
      const canDeleteDraft = draft.state === "new" ? canCreatePlayer : canDeletePlayer;

      return (
        <div key={draft.draft_id} className={cn("space-y-2", depth > 0 && "ml-5 border-l pl-4")}>
          <div className="rounded-lg border border-border/60 bg-background/60 p-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{draft.name || "Unnamed player"}</span>
                  <Badge variant="outline">{draft.role}</Badge>
                  {draft.is_substitution ? <Badge variant="secondary">Substitute</Badge> : null}
                  {draft.state === "new" ? <Badge variant="outline">New</Badge> : null}
                </div>
                <div className="text-sm text-muted-foreground">
                  {draft.user_id > 0 ? `${draft.user_name} · Rank ${draft.rank}` : "User not selected yet"}
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>{formatSubRoleLabel(draft.sub_role) ?? "No sub-role"}</span>
                  {draft.is_newcomer ? <StatusIcon icon={Sparkles} label="Newcomer" variant="warning" /> : null}
                  {draft.is_newcomer_role ? (
                    <StatusIcon icon={ArrowLeftRight} label="Newcomer role" variant="info" />
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {canCreatePlayer ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => openPlayerCreateDialog(draft)}
                  >
                    <UserPlus className="mr-2 h-4 w-4" />
                    Add Substitute
                  </Button>
                ) : null}
                {canEditDraft ? (
                  <Button type="button" variant="ghost" size="icon" onClick={() => openPlayerEditDialog(draft)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                ) : null}
                {canDeleteDraft ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-destructive"
                    onClick={() => handleRemoveRosterPlayer(draft)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
          {node.children.length ? renderRosterNodes(node.children, depth + 1) : null}
        </div>
      );
    });

  return (
    <>
      <Card className="border-border/40">
        <CardHeader className="flex flex-row items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <CardTitle className="text-sm font-semibold">Teams</CardTitle>
            <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground/50">
              <span>{teams.length} teams</span>
              <span>·</span>
              <span>{stagesCount} stages configured</span>
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
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) importTeamsMutation.mutate(file);
                    event.target.value = "";
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
            {canOpenCreateDialog ? (
              <Button onClick={openCreateTeamDialog}>
                <Plus className="mr-2 h-4 w-4" />
                Create Team
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          <AdminDetailTableShell variant="compact">
            <Table>
              <TableHeader>
                <TableRow className={tableStyles.headerRow}>
                  <TableHead className={tableStyles.head}>Team</TableHead>
                  <TableHead className={tableStyles.head}>Avg SR</TableHead>
                  <TableHead className={tableStyles.head}>Total SR</TableHead>
                  <TableHead className={tableStyles.head}>Players</TableHead>
                  <TableHead className={`${tableStyles.head} text-right`}>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {teams.length ? (
                  teams.slice(0, TOURNAMENT_DETAIL_PREVIEW_LIMIT).map((team) => (
                    <TableRow key={team.id} className={tableStyles.row}>
                      <TableCell className={tableStyles.cell}>
                        <span className="font-medium">{team.name}</span>
                      </TableCell>
                      <TableCell className={tableStyles.cell}>{team.avg_sr.toFixed(0)}</TableCell>
                      <TableCell className={tableStyles.cell}>{team.total_sr}</TableCell>
                      <TableCell className={tableStyles.cell}>{team.players.length}</TableCell>
                      <TableCell className={tableStyles.cell}>
                        <div className="flex items-center justify-end gap-2">
                          {canOpenEditDialog ? (
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
                  <TableRow className={tableStyles.row}>
                    <TableCell className={tableStyles.cell} colSpan={5}>
                      <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
                        <span>
                          No teams loaded for this tournament yet. Create one with a full roster or sync from
                          Challonge if the workspace is linked.
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
                          {canOpenCreateDialog ? (
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
          </AdminDetailTableShell>

          {teams.length > TOURNAMENT_DETAIL_PREVIEW_LIMIT ? (
            <div className="border-t border-border/30 px-3 py-2">
              <Link
                href={`/admin/teams?tournament=${tournamentId}`}
                className="text-[12px] text-muted-foreground/60 transition-colors hover:text-foreground"
              >
                Show all {teams.length} teams →
              </Link>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <EntityFormDialog
        open={teamDialogOpen}
        onOpenChange={(open) => {
          setTeamDialogOpen(open);
          if (!open) {
            resetTeamDialog();
          }
        }}
        title={editingTeam ? "Edit Team & Roster" : "Create Team & Roster"}
        description="Manage team identity, captain assignment, and the full tournament roster in one place."
        onSubmit={handleTeamSubmit}
        isSubmitting={saveTeamMutation.isPending}
        submittingLabel={editingTeam ? "Saving team..." : "Creating team..."}
        errorMessage={teamFormError}
        isDirty={isTeamDirty}
      >
        <div className="space-y-5">
          <div className="rounded-md border border-border/60 bg-muted/20 p-3">
            <p className="text-sm font-medium">
              {editingTeam ? "Edit team data and roster" : "Create a team with its starting roster"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Captain can only be selected from the roster below. Deleting a player removes its substitute chain.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="workspace-team-name">Team Name</Label>
            <Input
              id="workspace-team-name"
              value={teamFormData.name}
              disabled={editingTeam != null && !canUpdateTeam}
              placeholder="Team name"
              onChange={(event) =>
                setTeamFormData((current) => ({ ...current, name: event.target.value }))
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="workspace-team-captain">Captain</Label>
            <Select
              value={teamFormData.captain_id > 0 ? String(teamFormData.captain_id) : ""}
              onValueChange={(value) =>
                setTeamFormData((current) => ({
                  ...current,
                  captain_id: Number.parseInt(value, 10),
                }))
              }
              disabled={editingTeam != null && !canUpdateTeam}
            >
              <SelectTrigger id="workspace-team-captain">
                <SelectValue placeholder="Select captain from roster" />
              </SelectTrigger>
              <SelectContent>
                {captainOptions.map((option) => (
                  <SelectItem key={option.user_id} value={String(option.user_id)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {captainOptions.length
                ? "Captain options update automatically from the active roster."
                : "Add at least one player before choosing a captain."}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="workspace-team-avg-sr">Average SR</Label>
              <TeamNumberInput
                id="workspace-team-avg-sr"
                value={teamFormData.avg_sr}
                min={0}
                step={50}
                suffix="SR"
                disabled={editingTeam != null && !canUpdateTeam}
                onChange={(value) =>
                  setTeamFormData((current) => ({
                    ...current,
                    avg_sr: value,
                  }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="workspace-team-total-sr">Total SR</Label>
              <TeamNumberInput
                id="workspace-team-total-sr"
                value={teamFormData.total_sr}
                min={0}
                step={250}
                suffix="SR"
                disabled={editingTeam != null && !canUpdateTeam}
                onChange={(value) =>
                  setTeamFormData((current) => ({
                    ...current,
                    total_sr: value,
                  }))
                }
              />
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-border/60 p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-medium">Roster</p>
                <p className="text-xs text-muted-foreground">
                  {rosterDraftPlayers.length
                    ? `${rosterDraftPlayers.length} active roster records`
                    : "No roster members yet."}
                </p>
              </div>
              {canCreatePlayer ? (
                <Button type="button" variant="outline" onClick={() => openPlayerCreateDialog()}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Player
                </Button>
              ) : null}
            </div>

            {rosterTree.length ? (
              <div className="space-y-3">{renderRosterNodes(rosterTree)}</div>
            ) : (
              <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
                Create at least one player to make the team valid.
              </div>
            )}
          </div>
        </div>
      </EntityFormDialog>

      <EntityFormDialog
        open={playerDialogOpen}
        onOpenChange={(open) => {
          setPlayerDialogOpen(open);
          if (!open) {
            resetPlayerDialog();
          }
        }}
        title={
          playerDialogState?.mode === "edit"
            ? "Edit Roster Member"
            : playerDialogState?.mode === "create-substitute"
              ? "Add Substitute"
              : "Add Player"
        }
        description="Changes here stay local until you save the team dialog."
        onSubmit={handlePlayerDialogSubmit}
        isSubmitting={false}
        errorMessage={playerFormError}
        isDirty={isPlayerDirty}
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="team-roster-player-name">Player Name</Label>
            <Input
              id="team-roster-player-name"
              value={playerFormData.name}
              onChange={(event) =>
                setPlayerFormData((current) => ({ ...current, name: event.target.value }))
              }
            />
          </div>

          <div>
            <Label htmlFor="team-roster-player-user">Linked User</Label>
            <UserSearchCombobox
              id="team-roster-player-user"
              value={playerDialogDraft?.state === "existing" ? playerDialogDraft.user_id : playerFormData.user_id || undefined}
              selectedName={playerDialogDraft?.state === "existing" ? playerDialogDraft.user_name : playerFormData.user_name || undefined}
              placeholder="Search user by name"
              searchPlaceholder="Search user..."
              disabled={playerDialogDraft?.state === "existing"}
              allowClear={playerDialogDraft?.state !== "existing"}
              onSelect={(user: MinimizedUser | undefined) =>
                setPlayerFormData((current) => ({
                  ...current,
                  user_id: user?.id ?? 0,
                  user_name: user?.name ?? "",
                  name: current.name || user?.name || "",
                }))
              }
            />
            {playerDialogDraft?.state === "existing" ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Linked user cannot be changed for persisted roster members.
              </p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="team-roster-player-role">Role</Label>
            <Select
              value={playerFormData.role}
              onValueChange={(value) =>
                setPlayerFormData((current) => ({
                  ...current,
                  role: normalizePlayerRole(value),
                  sub_role: "",
                }))
              }
            >
              <SelectTrigger id="team-roster-player-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLAYER_ROLE_OPTIONS.map((role) => (
                  <SelectItem key={role} value={role}>
                    <RoleOptionContent role={role} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="team-roster-player-sub-role">Sub-role</Label>
            <SearchableSelect
              value={playerFormData.sub_role || "none"}
              options={playerSubRoleSelectOptions}
              placeholder="Select sub-role"
              searchPlaceholder="Search sub-role..."
              emptyMessage="No sub-roles found."
              onChange={(value) =>
                setPlayerFormData((current) => ({
                  ...current,
                  sub_role: value === "none" ? "" : value,
                }))
              }
            />
          </div>

          <div>
            <Label htmlFor="team-roster-player-rank">Rank</Label>
            <TeamNumberInput
              id="team-roster-player-rank"
              value={playerFormData.rank}
              min={0}
              step={1}
              onChange={(value) =>
                setPlayerFormData((current) => ({
                  ...current,
                  rank: value,
                }))
              }
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="team-roster-player-newcomer"
                checked={playerFormData.is_newcomer}
                onCheckedChange={(checked) =>
                  setPlayerFormData((current) => ({
                    ...current,
                    is_newcomer: checked === true,
                  }))
                }
              />
              <Label htmlFor="team-roster-player-newcomer" className="cursor-pointer">
                Newcomer
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="team-roster-player-newcomer-role"
                checked={playerFormData.is_newcomer_role}
                onCheckedChange={(checked) =>
                  setPlayerFormData((current) => ({
                    ...current,
                    is_newcomer_role: checked === true,
                  }))
                }
              />
              <Label htmlFor="team-roster-player-newcomer-role" className="cursor-pointer">
                Newcomer role
              </Label>
            </div>
          </div>
        </div>
      </EntityFormDialog>

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
          "Stored standings rows",
        ]}
        isDeleting={deleteTeamMutation.isPending}
      />
    </>
  );
}
