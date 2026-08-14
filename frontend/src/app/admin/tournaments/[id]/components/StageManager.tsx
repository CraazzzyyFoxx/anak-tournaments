"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  GitBranch,
  GitMerge,
  Link2,
  Loader2,
  Pencil,
  PlayCircle,
  Plus,
  Shield,
  Shuffle,
  Trash2,
  Undo2,
  Wand2,
  Zap
} from "lucide-react";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { EntityFormDialog } from "@/components/admin/EntityFormDialog";
import { InlineEditText } from "@/components/admin/InlineEditText";
import { EYEBROW_CLASS, TONE_CLASS, TONE_TEXT } from "@/components/admin/tone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ALL_TIEBREAKERS } from "@/lib/tiebreakers";
import { usePermissions } from "@/hooks/usePermissions";
import adminService from "@/services/admin.service";
import teamService from "@/services/team.service";
import type {
  Stage,
  StageItem,
  StageItemInput,
  StageItemType,
  StageType
} from "@/types/tournament.types";
import type { Team } from "@/types/team.types";
import { invalidateTournamentWorkspace } from "./tournamentWorkspace.queryKeys";
import { notify } from "@/lib/notify";
import type { StageBestOfConfig } from "@/types/admin.types";
import {
  BEST_OF_OPTIONS,
  parseStageBestOf,
  stageBestOfRoundSections
} from "@/lib/best-of";

const BRACKET_STAGE_TYPES: StageType[] = ["single_elimination", "double_elimination"];
const GROUP_STAGE_TYPES: StageType[] = ["round_robin", "swiss"];

const STAGE_TYPE_LABELS: Record<StageType, string> = {
  round_robin: "Round Robin",
  single_elimination: "Single Elimination",
  double_elimination: "Double Elimination",
  swiss: "Swiss"
};

const STAGE_ITEM_TYPE_LABELS: Record<StageItemType, string> = {
  group: "Group",
  bracket_upper: "Upper bracket",
  bracket_lower: "Lower bracket",
  single_bracket: "Single bracket"
};

const DEFAULT_SWISS_TIEBREAKERS = [
  "points",
  "median_buchholz",
  "buchholz",
  "match_wins",
  "score_differential",
  "head_to_head",
  "manual_override"
];

const DEFAULT_RR_TIEBREAKERS = [
  "points",
  "head_to_head",
  "median_buchholz",
  "match_wins",
  "score_differential",
  "buchholz",
  "manual_override"
];

const DEFAULT_BRACKET_TIEBREAKERS = [
  "points",
  "head_to_head",
  "median_buchholz",
  "score_differential",
  "match_wins",
  "buchholz",
  "manual_override"
];

interface StageManagerProps {
  tournamentId: number;
}

interface StageItemDraft {
  name: string;
  type: StageItemType;
}

/** Shape of `Stage.settings_json` as this screen reads and writes it. */
interface StageSettings {
  ranking_preset?: string;
  tiebreak_order?: string[];
  scoring?: { win?: number; draw?: number; loss?: number };
  swiss_bye_points?: number;
  de_grand_final_type?: "no_reset" | "with_reset";
  best_of?: StageBestOfConfig;
  [key: string]: unknown;
}

function getStageTeamSlots(stage: Stage) {
  return stage.items.reduce((acc, item) => acc + item.inputs.length, 0);
}

function getStageAssignedTeams(stage: Stage) {
  return stage.items.reduce(
    (acc, item) => acc + item.inputs.filter((input) => input.team_id != null).length,
    0
  );
}

/**
 * The team count that fixes a bracket's depth, mirroring `generate_encounters`
 * (services/admin/stage.py): total teams for single elimination or a non-split
 * double elimination; the upper-bracket half for a split double elimination
 * (a dedicated Lower bracket item, or the first half of a single bracket item's
 * seeds).
 *
 * Seeded inputs — then empty slots — are ground truth when present. Before
 * either exists (the common case: a playoff wired only after its groups finish)
 * the count is projected from the preceding group stage's `advance_count ×
 * groups`, so the best-of editor offers the bracket that WILL be generated
 * rather than a `max_rounds` guess that has no relation to the team count.
 */
function getStageBracketTeamCount(stage: Stage, splitLowerBracket: boolean, stages: Stage[]) {
  const countInputs = (items: StageItem[]) => {
    const assigned = items.reduce(
      (acc, item) => acc + item.inputs.filter((input) => input.team_id != null).length,
      0
    );
    return assigned > 0 ? assigned : items.reduce((acc, item) => acc + item.inputs.length, 0);
  };

  const isSplitDe = stage.stage_type === "double_elimination" && splitLowerBracket;
  const hasLowerItem = stage.items.some((item) => item.type === "bracket_lower");

  if (!isSplitDe) {
    const own = countInputs(stage.items);
    if (own > 0) return own;
  } else if (hasLowerItem) {
    const own = countInputs(stage.items.filter((item) => item.type !== "bracket_lower"));
    if (own > 0) return own;
  } else {
    const own = countInputs(stage.items);
    if (own > 0) return Math.floor(own / 2);
  }

  // Nothing wired yet: project from the group stage that will seed this one.
  return projectedBracketSeedCounts(stage, splitLowerBracket, stages).upper;
}

/**
 * The upper/lower seed counts the preceding group stage feeds into `stage`,
 * mirroring `_preceding_group_stage` + `_projected_bracket_seed_counts`: the
 * nearest earlier Swiss/round-robin stage seeds `advance_count` teams from EACH
 * of its groups, and a split double elimination splits EACH group's share (the
 * odd team out goes up) rather than halving the total — which for an odd
 * `advance_count` is a differently shaped bracket.
 */
function projectedBracketSeedCounts(
  stage: Stage,
  splitLowerBracket: boolean,
  stages: Stage[]
): { upper: number; lower: number } {
  const source = stages
    .filter(
      (candidate) =>
        candidate.order < stage.order &&
        (candidate.stage_type === "swiss" || candidate.stage_type === "round_robin")
    )
    .sort((left, right) => right.order - left.order)[0];
  if (!source || !source.advance_count || source.advance_count <= 0) return { upper: 0, lower: 0 };

  const groups = source.items.length || 1;
  const advance = source.advance_count;
  const isSplitDe = stage.stage_type === "double_elimination" && splitLowerBracket;

  if (isSplitDe && stage.items.some((item) => item.type === "bracket_lower")) {
    const lowerPerGroup = Math.floor(advance / 2);
    return { upper: groups * (advance - lowerPerGroup), lower: groups * lowerPerGroup };
  }

  const total = groups * advance;
  if (isSplitDe) {
    // One bracket item holds both halves; the seed list is split down the middle.
    return { upper: Math.floor(total / 2), lower: total - Math.floor(total / 2) };
  }
  return { upper: total, lower: 0 };
}

function getDefaultStageItemType(stageType: StageType): StageItemType {
  if (stageType === "single_elimination") return "single_bracket";
  if (stageType === "double_elimination") return "bracket_upper";
  return "group";
}

function getNextInputSlot(item: StageItem) {
  return item.inputs.reduce((max, input) => Math.max(max, input.slot), 0) + 1;
}

function getAssignedTeamIds(stage: Stage) {
  return new Set(
    stage.items.flatMap((item) =>
      item.inputs.map((input) => input.team_id).filter((teamId): teamId is number => teamId != null)
    )
  );
}

function getTeamName(teamById: Map<number, Team>, teamId: number | null) {
  if (teamId == null) return "Empty slot";
  return teamById.get(teamId)?.name ?? `Team #${teamId}`;
}

function normalizeMaxRounds(value: string | number, fallback = 5) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

// Series-length parsing and the offered values live in `@/lib/best-of`, mirrored
// from the backend resolver, so this editor and the veto editor cannot drift.
// The shared parser is also stricter than the local one it replaced: it drops
// non-integer and negative values instead of echoing back a number the server
// would silently ignore.

/** Strip empty fields; returns undefined when nothing is configured. */
function buildBestOfSettings(draft: StageBestOfConfig): StageBestOfConfig | undefined {
  const out: StageBestOfConfig = {};
  if (typeof draft.default === "number") out.default = draft.default;
  if (typeof draft.final === "number") out.final = draft.final;
  const by_round: Record<string, number> = {};
  for (const [key, value] of Object.entries(draft.by_round ?? {})) {
    if (typeof value === "number") by_round[key] = value;
  }
  if (Object.keys(by_round).length) out.by_round = by_round;
  return Object.keys(out).length ? out : undefined;
}

function getProgressPercent(completed: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((completed / total) * 100);
}

function getStageStatus(stage: Stage, hasEncounters: boolean) {
  if (stage.is_completed) return "Completed";
  if (stage.is_active) return "Active";
  // Bracket generated ahead of activation: visible to organizers, not yet
  // usable by captains (`shared.services.bracket.usability.is_encounter_live`).
  if (!stage.is_published && hasEncounters) return "Preview";
  return "Draft";
}

function getStageStatusClass(stage: Stage, hasEncounters: boolean) {
  if (stage.is_completed) return TONE_CLASS.success;
  if (stage.is_active) return TONE_CLASS.accent;
  if (!stage.is_published && hasEncounters) return TONE_CLASS.info;
  return TONE_CLASS.neutral;
}

function getInputDisplayLabel(
  input: StageItemInput,
  stages: Stage[],
  teamById: Map<number, Team>
) {
  if (input.team_id != null) {
    return getTeamName(teamById, input.team_id);
  }

  if (
    input.input_type === "tentative" &&
    input.source_stage_item_id != null &&
    input.source_position != null
  ) {
    const sourceItem = stages
      .flatMap((stage) => stage.items)
      .find((item) => item.id === input.source_stage_item_id);
    const groupName = sourceItem?.name ?? `Item ${input.source_stage_item_id}`;
    return `Winner of ${groupName} #${input.source_position}`;
  }

  return "Empty slot";
}

function isMergeableGroupStage(stage: Stage) {
  return (
    GROUP_STAGE_TYPES.includes(stage.stage_type) &&
    stage.items.length > 0 &&
    stage.items.every((item) => item.type === "group")
  );
}

function getDefaultMergedStageName(stage: Stage) {
  const stageName = stage.name.trim();
  const itemNames = new Set(stage.items.map((item) => item.name.trim().toLowerCase()));
  if (!stageName || itemNames.has(stageName.toLowerCase()) || /^[a-z]$/i.test(stageName)) {
    return "Groups";
  }
  return stageName;
}

export function StageManager({ tournamentId }: StageManagerProps) {
  const queryClient = useQueryClient();
  const { isSuperuser } = usePermissions();
  const [selectedStageId, setSelectedStageId] = useState<number | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [stageToDelete, setStageToDelete] = useState<Stage | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [seedStageConfirm, setSeedStageConfirm] = useState<Stage | null>(null);
  const [mergeStageConfirm, setMergeStageConfirm] = useState<Stage | null>(null);
  const [forceActivateStage, setForceActivateStage] = useState<Stage | null>(null);
  const [deactivateStageConfirm, setDeactivateStageConfirm] = useState<Stage | null>(null);
  const [regenerateStageConfirm, setRegenerateStageConfirm] = useState<Stage | null>(null);
  const [newStageName, setNewStageName] = useState("");
  const [newStageType, setNewStageType] = useState<StageType>("round_robin");
  const [newStageMaxRounds, setNewStageMaxRounds] = useState("5");
  const [newStageDeGrandFinalType, setNewStageDeGrandFinalType] = useState<
    "no_reset" | "with_reset"
  >("no_reset");
  const [stageTypeDrafts, setStageTypeDrafts] = useState<Record<number, StageType>>({});
  const [stageMaxRoundDrafts, setStageMaxRoundDrafts] = useState<Record<number, string>>({});
  const [stageAdvanceCountDrafts, setStageAdvanceCountDrafts] = useState<Record<number, string>>({});
  const [stageDeGfTypeDrafts, setStageDeGfTypeDrafts] = useState<
    Record<number, "no_reset" | "with_reset">
  >({});
  const [stageRankingPresetDrafts, setStageRankingPresetDrafts] = useState<Record<number, string>>({});
  const [stageTiebreakOrderDrafts, setStageTiebreakOrderDrafts] = useState<Record<number, string[]>>({});
  const [stageScoringWinDrafts, setStageScoringWinDrafts] = useState<Record<number, string>>({});
  const [stageScoringDrawDrafts, setStageScoringDrawDrafts] = useState<Record<number, string>>({});
  const [stageScoringLossDrafts, setStageScoringLossDrafts] = useState<Record<number, string>>({});
  const [stageSwissByePointsDrafts, setStageSwissByePointsDrafts] = useState<Record<number, string>>({});
  const [stageItemDrafts, setStageItemDrafts] = useState<Record<number, StageItemDraft>>({});
  const [teamDrafts, setTeamDrafts] = useState<Record<number, string>>({});
  const [editingItemTypeId, setEditingItemTypeId] = useState<number | null>(null);
  const [editingInputId, setEditingInputId] = useState<number | null>(null);
  const [editingInputTeamDraft, setEditingInputTeamDraft] = useState("");
  const [stageSplitLbDrafts, setStageSplitLbDrafts] = useState<Record<number, boolean>>({});
  const [stageBestOfDrafts, setStageBestOfDrafts] = useState<Record<number, StageBestOfConfig>>({});

  const fieldIdPrefix = useId();
  const stageTypeFieldId = `${fieldIdPrefix}-stage-type`;
  const swissRoundsFieldId = `${fieldIdPrefix}-swiss-rounds`;
  const grandFinalFieldId = `${fieldIdPrefix}-grand-final`;
  const groupSeedingFieldId = `${fieldIdPrefix}-group-seeding`;
  const advanceCountFieldId = `${fieldIdPrefix}-advance-count`;
  const rankingPresetFieldId = `${fieldIdPrefix}-ranking-preset`;
  const swissByePointsFieldId = `${fieldIdPrefix}-swiss-bye-points`;
  const winPointsFieldId = `${fieldIdPrefix}-win-points`;
  const drawPointsFieldId = `${fieldIdPrefix}-draw-points`;
  const lossPointsFieldId = `${fieldIdPrefix}-loss-points`;
  const bestOfDefaultId = `${fieldIdPrefix}-best-of-default`;
  const bestOfFinalId = `${fieldIdPrefix}-best-of-final`;

  const { data: stages = [], isLoading } = useQuery({
    queryKey: ["admin", "stages", tournamentId],
    queryFn: () => adminService.getStages(tournamentId)
  });

  const { data: tournament } = useQuery({
    queryKey: ["admin", "tournament", tournamentId],
    queryFn: () => adminService.getTournament(tournamentId)
  });

  const { data: teamsData, isLoading: isTeamsLoading } = useQuery({
    queryKey: ["admin", "tournament", "teams", tournamentId],
    queryFn: () => teamService.getAll({ tournamentId, sort: "name", order: "asc" })
  });

  const { data: stageProgress = [] } = useQuery({
    queryKey: ["admin", "stages", tournamentId, "progress"],
    queryFn: () => adminService.getStagesProgress(tournamentId),
    enabled: stages.length > 0
  });

  const orderedStages = useMemo(
    () => [...stages].sort((left, right) => left.order - right.order),
    [stages]
  );
  const teams = teamsData?.results ?? [];
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const progressByStageId = new Map(stageProgress.map((progress) => [progress.stage_id, progress]));
  const preferredStageId =
    orderedStages.find((stage) => stage.is_active)?.id ?? orderedStages[0]?.id ?? null;
  const effectiveSelectedStageId = orderedStages.some((stage) => stage.id === selectedStageId)
    ? selectedStageId
    : preferredStageId;
  const selectedStage =
    orderedStages.find((stage) => stage.id === effectiveSelectedStageId) ?? null;

  const invalidateStageData = () => {
    void invalidateTournamentWorkspace(queryClient, tournamentId);
  };

  const resetCreateStageForm = () => {
    setNewStageName("");
    setNewStageType("round_robin");
    setNewStageMaxRounds("5");
    setNewStageDeGrandFinalType("no_reset");
  };

  const createMutation = useMutation({
    mutationFn: () =>
      adminService.createStage(tournamentId, {
        name: newStageName.trim(),
        stage_type: newStageType,
        max_rounds: normalizeMaxRounds(newStageMaxRounds),
        order: stages.length,
        settings_json:
          newStageType === "double_elimination"
            ? { de_grand_final_type: newStageDeGrandFinalType }
            : null
      }),
    onSuccess: (stage) => {
      invalidateStageData();
      setSelectedStageId(stage.id);
      setCreateDialogOpen(false);
      resetCreateStageForm();
    }
  });

  const updateStageMutation = useMutation({
    mutationFn: ({
      stageId,
      data
    }: {
      stageId: number;
      data: {
        stage_type?: StageType;
        max_rounds?: number;
        advance_count?: number | null;
        split_lower_bracket?: boolean;
        settings_json?: Record<string, unknown> | null;
      };
    }) => adminService.updateStage(stageId, data),
    onSuccess: (_stage, variables) => {
      setStageTypeDrafts((current) => {
        const next = { ...current };
        delete next[variables.stageId];
        return next;
      });
      setStageMaxRoundDrafts((current) => {
        const next = { ...current };
        delete next[variables.stageId];
        return next;
      });
      setStageAdvanceCountDrafts((current) => {
        const next = { ...current };
        delete next[variables.stageId];
        return next;
      });
      setStageDeGfTypeDrafts((current) => {
        const next = { ...current };
        delete next[variables.stageId];
        return next;
      });
      setStageSplitLbDrafts((current) => {
        const next = { ...current };
        delete next[variables.stageId];
        return next;
      });
      setStageBestOfDrafts((current) => {
        const next = { ...current };
        delete next[variables.stageId];
        return next;
      });
      setStageRankingPresetDrafts((current) => {
        const next = { ...current };
        delete next[variables.stageId];
        return next;
      });
      setStageTiebreakOrderDrafts((current) => {
        const next = { ...current };
        delete next[variables.stageId];
        return next;
      });
      setStageScoringWinDrafts((current) => {
        const next = { ...current };
        delete next[variables.stageId];
        return next;
      });
      setStageScoringDrawDrafts((current) => {
        const next = { ...current };
        delete next[variables.stageId];
        return next;
      });
      setStageScoringLossDrafts((current) => {
        const next = { ...current };
        delete next[variables.stageId];
        return next;
      });
      setStageSwissByePointsDrafts((current) => {
        const next = { ...current };
        delete next[variables.stageId];
        return next;
      });
      invalidateStageData();
    }
  });

  const activateMutation = useMutation({
    mutationFn: (stageId: number) => adminService.activateStage(stageId),
    onSuccess: () => {
      invalidateStageData();
    }
  });

  const deactivateMutation = useMutation({
    mutationFn: (stageId: number) => adminService.deactivateStage(stageId),
    onSuccess: () => {
      setDeactivateStageConfirm(null);
      invalidateStageData();
      notify.success("Stage reverted to draft");
    },
    onError: (error) =>
      notify.apiError(error, { title: "Could not revert this stage to draft" })
  });

  const generateMutation = useMutation({
    mutationFn: (stageId: number) => adminService.generateBracket(stageId),
    onSuccess: () => {
      setRegenerateStageConfirm(null);
      invalidateStageData();
    },
    onError: (error) =>
      notify.apiError(error, { title: "Could not generate the bracket" })
  });

  const applyBestOfMutation = useMutation({
    mutationFn: (stageId: number) => adminService.applyStageBestOf(stageId),
    onSuccess: ({ updated }) => {
      notify.success(`Updated best-of on ${updated} match${updated === 1 ? "" : "es"}`);
      invalidateStageData();
    },
    onError: (error) =>
      notify.apiError(error, { title: "Could not apply best-of to existing matches" })
  });

  const deleteMutation = useMutation({
    mutationFn: (stageId: number) => adminService.deleteStage(stageId),
    onSuccess: () => {
      setStageToDelete(null);
      setSelectedStageId(null);
      invalidateStageData();
    }
  });

  const mergeGroupStagesMutation = useMutation({
    mutationFn: ({
      targetStageId,
      sourceStageIds,
      targetName
    }: {
      targetStageId: number;
      sourceStageIds: number[];
      targetName: string;
    }) =>
      adminService.mergeGroupStages(targetStageId, {
        source_stage_ids: sourceStageIds,
        target_name: targetName
      }),
    onSuccess: (stage) => {
      setMergeStageConfirm(null);
      setSelectedStageId(stage.id);
      invalidateStageData();
    }
  });

  const createItemMutation = useMutation({
    mutationFn: ({
      stageId,
      name,
      type,
      order
    }: {
      stageId: number;
      name: string;
      type: StageItemType;
      order: number;
    }) => adminService.createStageItem(stageId, { name, type, order }),
    onSuccess: (_item, variables) => {
      setStageItemDrafts((current) => {
        const next = { ...current };
        delete next[variables.stageId];
        return next;
      });
      invalidateStageData();
    }
  });

  const updateItemTypeMutation = useMutation({
    mutationFn: ({ stageItemId, type }: { stageItemId: number; type: StageItemType }) =>
      adminService.updateStageItem(stageItemId, { type }),
    onSuccess: () => {
      setEditingItemTypeId(null);
      invalidateStageData();
    }
  });

  const updateItemNameMutation = useMutation({
    mutationFn: ({ stageItemId, name }: { stageItemId: number; name: string }) =>
      adminService.updateStageItem(stageItemId, { name }),
    onSuccess: () => invalidateStageData(),
    onError: (error) => notify.apiError(error, { title: "Could not rename this structure item" })
  });

  const updateInputMutation = useMutation({
    mutationFn: ({ inputId, teamId }: { inputId: number; teamId: number }) =>
      adminService.updateStageItemInput(inputId, { team_id: teamId, input_type: "final" }),
    onSuccess: () => {
      setEditingInputId(null);
      setEditingInputTeamDraft("");
      invalidateStageData();
    }
  });

  const createInputMutation = useMutation({
    mutationFn: ({
      stageItemId,
      slot,
      teamId
    }: {
      stageItemId: number;
      slot: number;
      teamId: number;
    }) =>
      adminService.createStageItemInput(stageItemId, {
        slot,
        input_type: "final",
        team_id: teamId
      }),
    onSuccess: (_input, variables) => {
      setTeamDrafts((current) => {
        const next = { ...current };
        delete next[variables.stageItemId];
        return next;
      });
      invalidateStageData();
    }
  });

  const activateAndGenerateMutation = useMutation({
    mutationFn: ({ stageId, force }: { stageId: number; force?: boolean }) =>
      adminService.activateAndGenerateStage(stageId, force ? { force: true } : undefined),
    onSuccess: () => {
      setForceActivateStage(null);
      invalidateStageData();
    },
    onError: (error, variables) => {
      const detail = (error as { detail?: unknown })?.detail;
      const upstreamPending =
        typeof detail === "object" &&
        detail !== null &&
        "code" in detail &&
        (detail as { code: string }).code === "upstream_stages_not_completed";
      if (upstreamPending && !variables.force) {
        setForceActivateStage(
          orderedStages.find((stage) => stage.id === variables.stageId) ?? null
        );
        return;
      }
      setForceActivateStage(null);
      notify.apiError(error, {
        title: "Could not activate and generate this stage"
      });
    }
  });

  const seedTeamsMutation = useMutation({
    mutationFn: ({
      stageId,
      mode
    }: {
      stageId: number;
      mode: "snake_sr" | "by_total_sr" | "random";
    }) => {
      const teamIds = (teamsData?.results ?? []).map((team) => team.id);
      return adminService.seedTeams(stageId, { team_ids: teamIds, mode });
    },
    onSuccess: () => {
      setSeedStageConfirm(null);
      invalidateStageData();
    },
    onError: (error) =>
      notify.apiError(error, { title: "Could not seed teams into this stage" })
  });

  const handleCreateStageSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!newStageName.trim()) return;
    createMutation.mutate();
  };

  const handlePresetChange = (stageId: number, value: string) => {
    setStageRankingPresetDrafts((current) => ({
      ...current,
      [stageId]: value
    }));

    let newOrder = defaultTiebreakOrder;
    if (value === "challonge_swiss") {
      newOrder = DEFAULT_SWISS_TIEBREAKERS;
    } else if (value === "challonge_round_robin") {
      newOrder = DEFAULT_RR_TIEBREAKERS;
    } else if (value === "bracket_default") {
      newOrder = DEFAULT_BRACKET_TIEBREAKERS;
    }

    setStageTiebreakOrderDrafts((current) => ({
      ...current,
      [stageId]: newOrder
    }));
  };

  const selectedStageProgress = selectedStage ? progressByStageId.get(selectedStage.id) : null;
  const selectedStageAssignedTeamIds = selectedStage ? getAssignedTeamIds(selectedStage) : new Set<number>();
  const selectedStageTypeDraft = selectedStage
    ? stageTypeDrafts[selectedStage.id] ?? selectedStage.stage_type
    : "round_robin";
  const selectedStageMaxRoundDraft = selectedStage
    ? stageMaxRoundDrafts[selectedStage.id] ?? String(selectedStage.max_rounds ?? 5)
    : "5";
  const currentDeGfType =
    selectedStage && selectedStage.settings_json
      ? ((selectedStage.settings_json.de_grand_final_type as "no_reset" | "with_reset" | undefined) ??
        "no_reset")
      : "no_reset";
  const selectedStageDeGfTypeDraft = selectedStage
    ? stageDeGfTypeDrafts[selectedStage.id] ?? currentDeGfType
    : "no_reset";
  const currentSplitLowerBracket = selectedStage?.split_lower_bracket ?? false;
  const selectedStageSplitLbDraft = selectedStage
    ? stageSplitLbDrafts[selectedStage.id] ?? currentSplitLowerBracket
    : false;
  const maxRoundsDraftValue = selectedStage
    ? normalizeMaxRounds(selectedStageMaxRoundDraft, selectedStage.max_rounds ?? 5)
    : 5;
  const currentAdvanceCount =
    selectedStage?.advance_count != null ? String(selectedStage.advance_count) : "";
  const selectedStageAdvanceCountDraft = selectedStage
    ? stageAdvanceCountDrafts[selectedStage.id] ?? currentAdvanceCount
    : "";
  const selectedStageSettings = (selectedStage?.settings_json ?? {}) as StageSettings;
  const selectedStageRankingPresetDraft = selectedStage
    ? stageRankingPresetDrafts[selectedStage.id] ?? (selectedStageSettings.ranking_preset || "default")
    : "default";

  const defaultTiebreakOrder = selectedStage?.stage_type === "swiss"
    ? DEFAULT_SWISS_TIEBREAKERS
    : selectedStage?.stage_type === "round_robin"
    ? DEFAULT_RR_TIEBREAKERS
    : DEFAULT_BRACKET_TIEBREAKERS;

  const selectedStageTiebreakOrderDraft = selectedStage
    ? stageTiebreakOrderDrafts[selectedStage.id] ?? (selectedStageSettings.tiebreak_order || defaultTiebreakOrder)
    : [];

  const selectedStageScoringWinDraft = selectedStage
    ? stageScoringWinDrafts[selectedStage.id] ?? String(selectedStageSettings.scoring?.win ?? "")
    : "";
  const selectedStageScoringDrawDraft = selectedStage
    ? stageScoringDrawDrafts[selectedStage.id] ?? String(selectedStageSettings.scoring?.draw ?? "")
    : "";
  const selectedStageScoringLossDraft = selectedStage
    ? stageScoringLossDrafts[selectedStage.id] ?? String(selectedStageSettings.scoring?.loss ?? "")
    : "";
  const selectedStageSwissByePointsDraft = selectedStage
    ? stageSwissByePointsDrafts[selectedStage.id] ?? String(selectedStageSettings.swiss_bye_points ?? "")
    : "";

  const currentBestOf = parseStageBestOf(selectedStageSettings);
  const selectedBestOfDraft: StageBestOfConfig = selectedStage
    ? stageBestOfDrafts[selectedStage.id] ?? currentBestOf
    : {};
  const updateBestOfDraft = (patch: Partial<StageBestOfConfig>) => {
    if (!selectedStage) return;
    setStageBestOfDrafts((current) => ({
      ...current,
      [selectedStage.id]: { ...selectedBestOfDraft, ...patch }
    }));
  };
  const updateBestOfRound = (round: number, value: number | undefined) => {
    if (!selectedStage) return;
    const nextByRound = { ...(selectedBestOfDraft.by_round ?? {}) };
    if (value == null) delete nextByRound[String(round)];
    else nextByRound[String(round)] = value;
    setStageBestOfDrafts((current) => ({
      ...current,
      [selectedStage.id]: { ...selectedBestOfDraft, by_round: nextByRound }
    }));
  };
  const bestOfRoundSections = stageBestOfRoundSections({
    stageType: selectedStageTypeDraft,
    maxRounds: maxRoundsDraftValue,
    bracketTeamCount: selectedStage
      ? getStageBracketTeamCount(selectedStage, selectedStageSplitLbDraft, stages)
      : 0,
    splitLowerBracket: selectedStageSplitLbDraft,
    configuredRounds: Object.keys(selectedBestOfDraft.by_round ?? {}).map(Number)
  });
  const isDoubleElimination = selectedStageTypeDraft === "double_elimination";

  const selectedItemDraft = selectedStage
    ? stageItemDrafts[selectedStage.id] ?? {
        name: "",
        type: getDefaultStageItemType(selectedStage.stage_type)
      }
    : { name: "", type: "group" as StageItemType };
  const nextItemName =
    selectedItemDraft.type === "group"
      ? `Group ${(selectedStage?.items.length ?? 0) + 1}`
      : "Bracket";
  const mergeableGroupStageCandidates =
    selectedStage && isMergeableGroupStage(selectedStage)
      ? orderedStages.filter(
          (stage) =>
            stage.id !== selectedStage.id &&
            stage.stage_type === selectedStage.stage_type &&
            isMergeableGroupStage(stage)
        )
      : [];
  const mergedStageName = selectedStage ? getDefaultMergedStageName(selectedStage) : "Groups";
  const createStageDirty =
    newStageName.trim().length > 0 ||
    newStageType !== "round_robin" ||
    newStageMaxRounds !== "5" ||
    newStageDeGrandFinalType !== "no_reset";

  if (isLoading) {
    return <Skeleton className="h-72 w-full rounded-xl" />;
  }

  return (
    <>
      <Card className="overflow-hidden border-border/40">
        <CardHeader className="gap-3 pb-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <GitBranch className="size-4 text-primary" aria-hidden />
                <CardTitle asChild className="text-base">
                  <h2>Tournament flow</h2>
                </CardTitle>
              </div>
              <CardDescription className="mt-1">
                Build the bracket path one stage at a time, then use focused actions on the
                selected stage.
              </CardDescription>
            </div>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="size-4" aria-hidden />
              Add stage
            </Button>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          {orderedStages.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/70 bg-muted/10 p-6 text-center">
              <p className="text-sm text-muted-foreground">
                No stages yet. Add the first phase, then groups, playoffs and finals appear here as
                a readable flow.
              </p>
              <Button className="mt-4" onClick={() => setCreateDialogOpen(true)}>
                <Plus className="size-4" aria-hidden />
                Add first stage
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
              <div className="rounded-xl border border-border/60 bg-background/40">
                <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold">Flow timeline</p>
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {orderedStages.length} stage{orderedStages.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <Badge variant="outline" className="tabular-nums">
                    {teams.length} teams
                  </Badge>
                </div>

                <div className="flex flex-col gap-2 p-2">
                  {orderedStages.map((stage, index) => {
                    const progress = progressByStageId.get(stage.id);
                    const hasEncounters = (progress?.total ?? 0) > 0;
                    const stageSlots = getStageTeamSlots(stage);
                    const assignedTeams = getStageAssignedTeams(stage);
                    const progressPercent = progress
                      ? getProgressPercent(progress.completed, progress.total)
                      : 0;
                    const isSelected = effectiveSelectedStageId === stage.id;

                    return (
                      <div
                        key={stage.id}
                        className={cn(
                          "relative rounded-lg border border-transparent p-3 transition-colors hover:border-border/70 hover:bg-muted/20 focus-within:ring-1 focus-within:ring-ring",
                          isSelected && "border-primary/50 bg-primary/10"
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <span
                            aria-hidden
                            className={cn(
                              "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums",
                              isSelected
                                ? "border-primary/60 bg-primary/15 text-primary"
                                : "border-border/70 bg-background text-muted-foreground"
                            )}
                          >
                            {index + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <button
                                type="button"
                                aria-label={`Select stage ${stage.name}`}
                                aria-current={isSelected ? "true" : undefined}
                                className="min-w-0 truncate text-left text-sm font-semibold after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
                                onClick={() => setSelectedStageId(stage.id)}
                              >
                                {stage.name}
                              </button>
                              <Badge
                                variant="outline"
                                className={cn("shrink-0", getStageStatusClass(stage, hasEncounters))}
                              >
                                {getStageStatus(stage, hasEncounters)}
                              </Badge>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                              <span>{STAGE_TYPE_LABELS[stage.stage_type]}</span>
                              <span aria-hidden>·</span>
                              <span className="tabular-nums">{stage.items.length} item(s)</span>
                              <span aria-hidden>·</span>
                              <span className="tabular-nums">
                                {assignedTeams}/{stageSlots} slots
                              </span>
                            </div>
                            {progress && progress.total > 0 ? (
                              <div className="mt-3">
                                <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                                  <span>Matches</span>
                                  <span className="tabular-nums">
                                    {progress.completed}/{progress.total}
                                  </span>
                                </div>
                                <Progress
                                  value={progressPercent}
                                  className="h-1.5"
                                  aria-label={`${progress.completed} of ${progress.total} matches complete`}
                                />
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {selectedStage ? (
                <div className="min-w-0 rounded-xl border border-border/60 bg-background/40">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-4">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h3 className="truncate text-lg font-semibold">{selectedStage.name}</h3>
                      {selectedStage.challonge_slug ? (
                        <a
                          className="inline-flex items-center gap-1 rounded-full border border-primary/30 px-2 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                          href={`https://challonge.com/${selectedStage.challonge_slug}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Link2 className="size-3" aria-hidden />
                          Challonge
                        </a>
                      ) : null}
                    </div>

                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setStageToDelete(selectedStage)}
                    >
                      <Trash2 className="size-4" aria-hidden />
                      Delete stage
                    </Button>
                  </div>

                  <div className="flex flex-col gap-4 p-4">
                    <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-4">
                      {GROUP_STAGE_TYPES.includes(selectedStage.stage_type) &&
                      teams.length > 0 &&
                      selectedStage.items.length > 0 ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            seedTeamsMutation.isPending &&
                            seedTeamsMutation.variables?.stageId === selectedStage.id
                          }
                          onClick={() => setSeedStageConfirm(selectedStage)}
                        >
                          {seedTeamsMutation.isPending &&
                          seedTeamsMutation.variables?.stageId === selectedStage.id ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden />
                          ) : (
                            <Shuffle className="size-4" aria-hidden />
                          )}
                          Seed by SR
                        </Button>
                      ) : null}

                      {mergeableGroupStageCandidates.length > 0 ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            mergeGroupStagesMutation.isPending &&
                            mergeGroupStagesMutation.variables?.targetStageId === selectedStage.id
                          }
                          onClick={() => setMergeStageConfirm(selectedStage)}
                        >
                          {mergeGroupStagesMutation.isPending &&
                          mergeGroupStagesMutation.variables?.targetStageId === selectedStage.id ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden />
                          ) : (
                            <GitMerge className="size-4" aria-hidden />
                          )}
                          {mergeGroupStagesMutation.isPending &&
                          mergeGroupStagesMutation.variables?.targetStageId === selectedStage.id
                            ? "Merging…"
                            : "Merge groups"}
                        </Button>
                      ) : null}

                      {!selectedStage.is_active ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={activateMutation.isPending}
                          onClick={() => activateMutation.mutate(selectedStage.id)}
                        >
                          {activateMutation.isPending &&
                          activateMutation.variables === selectedStage.id ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden />
                          ) : (
                            <PlayCircle className="size-4" aria-hidden />
                          )}
                          {activateMutation.isPending &&
                          activateMutation.variables === selectedStage.id
                            ? "Activating…"
                            : "Activate stage"}
                        </Button>
                      ) : null}

                      {(selectedStage.is_active || selectedStage.is_published) &&
                      !selectedStage.is_completed ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={deactivateMutation.isPending}
                          onClick={() => setDeactivateStageConfirm(selectedStage)}
                          title="Reverts this stage to Draft/preview — only possible while every one of its matches is still unplayed"
                        >
                          {deactivateMutation.isPending &&
                          deactivateMutation.variables === selectedStage.id ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden />
                          ) : (
                            <Undo2 className="size-4" aria-hidden />
                          )}
                          {deactivateMutation.isPending &&
                          deactivateMutation.variables === selectedStage.id
                            ? "Reverting…"
                            : "Revert to draft"}
                        </Button>
                      ) : null}

                      <Button
                        size="sm"
                        variant="outline"
                        disabled={generateMutation.isPending}
                        onClick={() => {
                          if ((selectedStageProgress?.total ?? 0) > 0) {
                            setRegenerateStageConfirm(selectedStage);
                          } else {
                            generateMutation.mutate(selectedStage.id);
                          }
                        }}
                        title="Generates the bracket as a preview without activating the stage — captains cannot report or veto until it is activated. With no teams seeded yet, a playoff is built from the group stage's advancing count and filled in once the groups finish."
                      >
                        {generateMutation.isPending &&
                        generateMutation.variables === selectedStage.id ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden />
                        ) : (
                          <Wand2 className="size-4" aria-hidden />
                        )}
                        {generateMutation.isPending &&
                        generateMutation.variables === selectedStage.id
                          ? "Generating…"
                          : "Generate bracket"}
                      </Button>

                      {BRACKET_STAGE_TYPES.includes(selectedStage.stage_type) ? (
                        <Button
                          size="sm"
                          disabled={
                            activateAndGenerateMutation.isPending &&
                            activateAndGenerateMutation.variables?.stageId === selectedStage.id
                          }
                          onClick={() =>
                            activateAndGenerateMutation.mutate({ stageId: selectedStage.id })
                          }
                          title="Resolve tentative inputs from prior stage standings, then generate the bracket"
                        >
                          {activateAndGenerateMutation.isPending &&
                          activateAndGenerateMutation.variables?.stageId === selectedStage.id ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden />
                          ) : (
                            <Zap className="size-4" aria-hidden />
                          )}
                          {activateAndGenerateMutation.isPending &&
                          activateAndGenerateMutation.variables?.stageId === selectedStage.id
                            ? "Working…"
                            : "Activate & generate"}
                        </Button>
                      ) : null}
                    </div>

                    <section className="rounded-lg border border-border/60 bg-muted/10 p-3">
                      <div className="mb-3">
                        <h3 className="text-sm font-semibold">Structure</h3>
                        <p className="text-xs text-muted-foreground">
                          Manage groups, bracket lanes, and assigned teams for this stage.
                        </p>
                      </div>

                      {selectedStageProgress && selectedStageProgress.items.length > 1 ? (
                        <div className="mb-3 flex flex-wrap gap-1.5">
                          {selectedStageProgress.items.map((itemProgress) => (
                            <Badge
                              key={itemProgress.stage_item_id}
                              variant="outline"
                              className={cn(
                                "text-xs tabular-nums",
                                itemProgress.is_completed && TONE_CLASS.success
                              )}
                            >
                              {itemProgress.name}: {itemProgress.completed}/{itemProgress.total}
                            </Badge>
                          ))}
                        </div>
                      ) : null}

                      {selectedStage.items.length > 0 ? (
                        <div className="grid gap-3 2xl:grid-cols-2">
                          {selectedStage.items.map((item) => (
                            <div
                              key={item.id}
                              className="flex flex-col gap-3 rounded-lg border border-border/60 bg-background/50 p-3"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <InlineEditText
                                    value={item.name}
                                    label="structure item name"
                                    textClassName="text-sm font-medium"
                                    onSave={(name) =>
                                      updateItemNameMutation.mutateAsync({
                                        stageItemId: item.id,
                                        name
                                      })
                                    }
                                  />
                                  <p className="text-xs tabular-nums text-muted-foreground">
                                    {item.inputs.length} slot(s)
                                  </p>
                                </div>
                                {editingItemTypeId === item.id ? (
                                  <div className="flex shrink-0 items-center gap-1">
                                    <Select
                                      defaultValue={item.type}
                                      onValueChange={(value) => {
                                        updateItemTypeMutation.mutate({
                                          stageItemId: item.id,
                                          type: value as StageItemType
                                        });
                                      }}
                                    >
                                      <SelectTrigger
                                        aria-label={`Structure type for ${item.name}`}
                                        className="h-8 w-36 text-xs"
                                      >
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {Object.entries(STAGE_ITEM_TYPE_LABELS).map(
                                          ([value, label]) => (
                                            <SelectItem
                                              key={value}
                                              value={value}
                                              className="text-xs"
                                            >
                                              {label}
                                            </SelectItem>
                                          )
                                        )}
                                      </SelectContent>
                                    </Select>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="size-8"
                                      aria-label="Cancel item type edit"
                                      onClick={() => setEditingItemTypeId(null)}
                                    >
                                      <span aria-hidden>×</span>
                                    </Button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    className="flex shrink-0 items-center gap-1 rounded-md border border-transparent px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    onClick={() => setEditingItemTypeId(item.id)}
                                    aria-label={`Change structure type of ${item.name}`}
                                  >
                                    {STAGE_ITEM_TYPE_LABELS[item.type]}
                                    <Pencil className="size-3.5" aria-hidden />
                                  </button>
                                )}
                              </div>

                              {item.inputs.length > 0 ? (
                                <div className="flex flex-col gap-1">
                                  {[...item.inputs]
                                    .sort((left, right) => left.slot - right.slot)
                                    .map((input) => {
                                      const label = getInputDisplayLabel(input, stages, teamById);
                                      const isEditingThisInput = editingInputId === input.id;
                                      const canSwapAssignedTeams = input.team_id != null;

                                      return (
                                        <div
                                          key={input.id}
                                          className="flex items-center gap-2 rounded-md border border-border/50 bg-background/70 px-2.5 py-1.5 text-xs"
                                        >
                                          <span className="min-w-0 flex-1 truncate">
                                            #{input.slot} {label}
                                          </span>

                                          {isEditingThisInput ? (
                                            <>
                                              <Select
                                                value={editingInputTeamDraft}
                                                onValueChange={setEditingInputTeamDraft}
                                              >
                                                <SelectTrigger
                                                  aria-label={`Team for slot ${input.slot} of ${item.name}`}
                                                  className="h-7 w-40 text-xs"
                                                >
                                                  <SelectValue placeholder="Pick team" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                  {teams.map((team) => (
                                                    <SelectItem
                                                      key={team.id}
                                                      value={team.id.toString()}
                                                      disabled={
                                                        selectedStageAssignedTeamIds.has(team.id) &&
                                                        team.id !== input.team_id &&
                                                        !canSwapAssignedTeams
                                                      }
                                                      className="text-xs"
                                                    >
                                                      {team.name}
                                                    </SelectItem>
                                                  ))}
                                                </SelectContent>
                                              </Select>
                                              <Button
                                                size="icon"
                                                variant="ghost"
                                                className="size-8 shrink-0"
                                                aria-label="Save team assignment"
                                                disabled={
                                                  !editingInputTeamDraft ||
                                                  (updateInputMutation.isPending &&
                                                    updateInputMutation.variables?.inputId === input.id)
                                                }
                                                onClick={() =>
                                                  updateInputMutation.mutate({
                                                    inputId: input.id,
                                                    teamId: Number(editingInputTeamDraft)
                                                  })
                                                }
                                              >
                                                {updateInputMutation.isPending &&
                                                updateInputMutation.variables?.inputId === input.id ? (
                                                  <Loader2 className="size-3 animate-spin" aria-hidden />
                                                ) : (
                                                  <CheckCircle2 className="size-3" aria-hidden />
                                                )}
                                              </Button>
                                              <Button
                                                size="icon"
                                                variant="ghost"
                                                className="size-8 shrink-0"
                                                aria-label="Cancel team assignment edit"
                                                onClick={() => {
                                                  setEditingInputId(null);
                                                  setEditingInputTeamDraft("");
                                                }}
                                              >
                                                <span aria-hidden>×</span>
                                              </Button>
                                            </>
                                          ) : (
                                            <>
                                              <Badge
                                                variant="outline"
                                                className={cn(
                                                  "shrink-0 text-xs",
                                                  input.input_type === "tentative" &&
                                                    TONE_CLASS.warning
                                                )}
                                              >
                                                {input.input_type}
                                              </Badge>
                                              {input.input_type !== "empty" ? (
                                                <button
                                                  type="button"
                                                  className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                  aria-label={
                                                    input.input_type === "tentative"
                                                      ? `Override team in slot ${input.slot} of ${item.name}`
                                                      : `Change team in slot ${input.slot} of ${item.name}`
                                                  }
                                                  onClick={() => {
                                                    setEditingInputId(input.id);
                                                    setEditingInputTeamDraft(
                                                      input.team_id?.toString() ?? ""
                                                    );
                                                  }}
                                                >
                                                  <Pencil className="size-3.5" aria-hidden />
                                                </button>
                                              ) : null}
                                            </>
                                          )}
                                        </div>
                                      );
                                    })}
                                </div>
                              ) : (
                                <p className="rounded-md border border-dashed border-border/60 bg-background/40 px-3 py-2 text-xs text-muted-foreground">
                                  No teams assigned yet. Pick a team below to fill the first slot.
                                </p>
                              )}

                              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                                <Select
                                  value={teamDrafts[item.id]}
                                  onValueChange={(value) =>
                                    setTeamDrafts((current) => ({ ...current, [item.id]: value }))
                                  }
                                  disabled={isTeamsLoading || teams.length === 0}
                                >
                                  <SelectTrigger
                                    aria-label={`Team to add to ${item.name}`}
                                    className="h-9"
                                  >
                                    <SelectValue
                                      placeholder={isTeamsLoading ? "Loading teams…" : "Select team"}
                                    />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {teams.map((team) => (
                                      <SelectItem
                                        key={team.id}
                                        value={team.id.toString()}
                                        disabled={selectedStageAssignedTeamIds.has(team.id)}
                                      >
                                        {team.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={
                                    createInputMutation.isPending ||
                                    !teamDrafts[item.id] ||
                                    selectedStageAssignedTeamIds.has(Number(teamDrafts[item.id]))
                                  }
                                  onClick={() =>
                                    createInputMutation.mutate({
                                      stageItemId: item.id,
                                      slot: getNextInputSlot(item),
                                      teamId: Number(teamDrafts[item.id])
                                    })
                                  }
                                >
                                  {createInputMutation.isPending &&
                                  createInputMutation.variables?.stageItemId === item.id ? (
                                    <Loader2 className="size-4 animate-spin" aria-hidden />
                                  ) : (
                                    <Plus className="size-4" aria-hidden />
                                  )}
                                  Add team
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-lg border border-dashed border-border/70 bg-background/40 p-4 text-sm text-muted-foreground">
                          This stage has no structure items yet. Add a group or bracket lane below.
                        </div>
                      )}

                      <div className="mt-3 grid gap-2 border-t border-border/60 pt-3 lg:grid-cols-[minmax(0,1fr)_200px_auto] lg:items-end">
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor={`stage-item-name-${selectedStage.id}`} className="text-xs">
                            Structure item name
                          </Label>
                          <Input
                            id={`stage-item-name-${selectedStage.id}`}
                            className="h-9"
                            placeholder={nextItemName}
                            value={selectedItemDraft.name}
                            onChange={(event) =>
                              setStageItemDrafts((current) => ({
                                ...current,
                                [selectedStage.id]: {
                                  ...selectedItemDraft,
                                  name: event.target.value
                                }
                              }))
                            }
                          />
                        </div>

                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor={`stage-item-type-${selectedStage.id}`} className="text-xs">
                            Type
                          </Label>
                          <Select
                            value={selectedItemDraft.type}
                            onValueChange={(value) =>
                              setStageItemDrafts((current) => ({
                                ...current,
                                [selectedStage.id]: {
                                  ...selectedItemDraft,
                                  type: value as StageItemType
                                }
                              }))
                            }
                          >
                            <SelectTrigger id={`stage-item-type-${selectedStage.id}`} className="h-9">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(STAGE_ITEM_TYPE_LABELS).map(([value, label]) => (
                                <SelectItem key={value} value={value}>
                                  {label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={
                            createItemMutation.isPending &&
                            createItemMutation.variables?.stageId === selectedStage.id
                          }
                          onClick={() =>
                            createItemMutation.mutate({
                              stageId: selectedStage.id,
                              name: selectedItemDraft.name.trim() || nextItemName,
                              type: selectedItemDraft.type,
                              order: selectedStage.items.length
                            })
                          }
                        >
                          {createItemMutation.isPending &&
                          createItemMutation.variables?.stageId === selectedStage.id ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden />
                          ) : (
                            <Plus className="size-4" aria-hidden />
                          )}
                          {createItemMutation.isPending &&
                          createItemMutation.variables?.stageId === selectedStage.id
                            ? "Adding…"
                            : "Add structure"}
                        </Button>
                      </div>
                    </section>

                    <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                      <section className="rounded-lg border border-dashed border-border/70 bg-muted/5">
                        <CollapsibleTrigger asChild>
                          <Button
                            variant="ghost"
                            className="flex h-auto w-full justify-between rounded-lg px-3 py-2.5"
                          >
                            <span className="flex items-center gap-2 text-sm font-semibold">
                              <Shield className="size-4" aria-hidden />
                              Advanced
                            </span>
                            <ChevronDown
                              aria-hidden
                              className={cn(
                                "size-4 transition-transform",
                                advancedOpen && "rotate-180"
                              )}
                            />
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="border-t border-border/60 p-3 space-y-4">
                            <div className="mb-1 flex items-start gap-2 text-xs text-muted-foreground">
                              <AlertTriangle className={cn("mt-0.5 size-3.5", TONE_TEXT.warning)} aria-hidden />
                              <span>
                                Advanced configurations for bracket generation, standings preset, tiebreaker criteria, and point scoring.
                              </span>
                            </div>

                            <div className="space-y-3">
                              <h4 className={EYEBROW_CLASS}>Stage properties</h4>
                              <div className="flex flex-col gap-2 sm:flex-row">
                                <div className="flex-1">
                                  <Label htmlFor={stageTypeFieldId} className="text-xs text-muted-foreground">
                                    Stage type
                                  </Label>
                                  <Select
                                    value={selectedStageTypeDraft}
                                    onValueChange={(value) =>
                                      setStageTypeDrafts((current) => ({
                                        ...current,
                                        [selectedStage.id]: value as StageType
                                      }))
                                    }
                                    disabled={!isSuperuser}
                                  >
                                    <SelectTrigger id={stageTypeFieldId} className="h-9 w-full">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {Object.entries(STAGE_TYPE_LABELS).map(([value, label]) => (
                                        <SelectItem key={value} value={value}>
                                          {label}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  {!isSuperuser && (
                                    <span className="text-xs text-muted-foreground">Only superusers can modify stage type after creation.</span>
                                  )}
                                </div>

                                {selectedStageTypeDraft === "swiss" ? (
                                  <div>
                                    <Label htmlFor={swissRoundsFieldId} className="text-xs text-muted-foreground">
                                      Swiss max rounds
                                    </Label>
                                    <NumberInput
                                      id={swissRoundsFieldId}
                                      className="h-9 w-full sm:w-[120px]"
                                      integer
                                      min={1}
                                      value={Number(selectedStageMaxRoundDraft)}
                                      onValueChange={(next) =>
                                        setStageMaxRoundDrafts((current) => ({
                                          ...current,
                                          [selectedStage.id]: next == null ? "" : String(next)
                                        }))
                                      }
                                    />
                                  </div>
                                ) : null}

                                {selectedStageTypeDraft === "double_elimination" ? (
                                  <div>
                                    <Label htmlFor={grandFinalFieldId} className="text-xs text-muted-foreground">
                                      Grand final format
                                    </Label>
                                    <Select
                                      value={selectedStageDeGfTypeDraft}
                                      onValueChange={(value) =>
                                        setStageDeGfTypeDrafts((current) => ({
                                          ...current,
                                          [selectedStage.id]: value as "no_reset" | "with_reset"
                                        }))
                                      }
                                    >
                                      <SelectTrigger id={grandFinalFieldId} className="h-9 w-full sm:w-[160px]">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="no_reset">No reset</SelectItem>
                                        <SelectItem value="with_reset">With reset</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                ) : null}

                                {selectedStageTypeDraft === "double_elimination" ? (
                                  <div>
                                    <Label htmlFor={groupSeedingFieldId} className="text-xs text-muted-foreground">
                                      Group seeding
                                    </Label>
                                    <Select
                                      value={selectedStageSplitLbDraft ? "split" : "all_upper"}
                                      onValueChange={(value) =>
                                        setStageSplitLbDrafts((current) => ({
                                          ...current,
                                          [selectedStage.id]: value === "split"
                                        }))
                                      }
                                    >
                                      <SelectTrigger id={groupSeedingFieldId} className="h-9 w-full sm:w-[220px]">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="all_upper">All advancing → Upper bracket</SelectItem>
                                        <SelectItem value="split">Split: half Upper, half Lower</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    <span className="text-xs text-muted-foreground">
                                      Uses the group stage&apos;s &quot;Teams advancing to playoff&quot; count; auto-wired on Activate &amp; generate.
                                    </span>
                                  </div>
                                ) : null}
                              </div>
                            </div>

                            {GROUP_STAGE_TYPES.includes(selectedStageTypeDraft) && (
                              <>
                                <div className="border-t border-border/40 pt-3 space-y-3">
                                  <h4 className={EYEBROW_CLASS}>Standings &amp; scoring settings</h4>

                                  <div>
                                    <Label htmlFor={advanceCountFieldId} className="text-xs text-muted-foreground">
                                      Teams advancing to playoff (per group)
                                    </Label>
                                    <NumberInput
                                      id={advanceCountFieldId}
                                      integer
                                      min={1}
                                      placeholder="Auto (derive from bracket)"
                                      className="h-9 w-full sm:w-[280px]"
                                      value={
                                        selectedStageAdvanceCountDraft === ""
                                          ? null
                                          : Number(selectedStageAdvanceCountDraft)
                                      }
                                      onValueChange={(next) =>
                                        setStageAdvanceCountDrafts((current) => ({
                                          ...current,
                                          [selectedStage.id]: next == null ? "" : String(next)
                                        }))
                                      }
                                    />
                                    <span className="text-xs text-muted-foreground">
                                      Top N from each group advance. Leave empty to auto-derive from the bracket wiring.
                                    </span>
                                  </div>

                                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                    <div>
                                      <Label htmlFor={rankingPresetFieldId} className="text-xs text-muted-foreground">
                                        Standings preset
                                      </Label>
                                      <Select
                                        value={selectedStageRankingPresetDraft}
                                        onValueChange={(value) => handlePresetChange(selectedStage.id, value)}
                                      >
                                        <SelectTrigger id={rankingPresetFieldId} className="h-9 w-full">
                                          <SelectValue placeholder="System default" />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="default">System default (based on type)</SelectItem>
                                          <SelectItem value="challonge_swiss">Challonge Swiss (Buchholz first)</SelectItem>
                                          <SelectItem value="challonge_round_robin">Challonge Round Robin</SelectItem>
                                          <SelectItem value="bracket_default">Default bracket</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>

                                    {selectedStageTypeDraft === "swiss" ? (
                                      <div>
                                        <Label htmlFor={swissByePointsFieldId} className="text-xs text-muted-foreground">
                                          Swiss bye points
                                        </Label>
                                        <NumberInput
                                          id={swissByePointsFieldId}
                                          placeholder={String(selectedStageScoringWinDraft || tournament?.win_points || 1.0)}
                                          className="h-9 w-full"
                                          value={
                                            selectedStageSwissByePointsDraft === ""
                                              ? null
                                              : Number(selectedStageSwissByePointsDraft)
                                          }
                                          onValueChange={(next) =>
                                            setStageSwissByePointsDrafts((current) => ({
                                              ...current,
                                              [selectedStage.id]: next == null ? "" : String(next)
                                            }))
                                          }
                                        />
                                      </div>
                                    ) : null}
                                  </div>

                                  <div className="grid grid-cols-3 gap-3">
                                    <div>
                                      <Label htmlFor={winPointsFieldId} className="text-xs text-muted-foreground">
                                        Win points override
                                      </Label>
                                      <NumberInput
                                        id={winPointsFieldId}
                                        placeholder={String(tournament?.win_points ?? 1.0)}
                                        className="h-9 w-full bg-background/30"
                                        value={
                                          selectedStageScoringWinDraft === ""
                                            ? null
                                            : Number(selectedStageScoringWinDraft)
                                        }
                                        onValueChange={(next) =>
                                          setStageScoringWinDrafts((current) => ({
                                            ...current,
                                            [selectedStage.id]: next == null ? "" : String(next)
                                          }))
                                        }
                                      />
                                    </div>
                                    <div>
                                      <Label htmlFor={drawPointsFieldId} className="text-xs text-muted-foreground">
                                        Draw points override
                                      </Label>
                                      <NumberInput
                                        id={drawPointsFieldId}
                                        placeholder={String(tournament?.draw_points ?? 0.5)}
                                        className="h-9 w-full bg-background/30"
                                        value={
                                          selectedStageScoringDrawDraft === ""
                                            ? null
                                            : Number(selectedStageScoringDrawDraft)
                                        }
                                        onValueChange={(next) =>
                                          setStageScoringDrawDrafts((current) => ({
                                            ...current,
                                            [selectedStage.id]: next == null ? "" : String(next)
                                          }))
                                        }
                                      />
                                    </div>
                                    <div>
                                      <Label htmlFor={lossPointsFieldId} className="text-xs text-muted-foreground">
                                        Loss points override
                                      </Label>
                                      <NumberInput
                                        id={lossPointsFieldId}
                                        placeholder={String(tournament?.loss_points ?? 0.0)}
                                        className="h-9 w-full bg-background/30"
                                        value={
                                          selectedStageScoringLossDraft === ""
                                            ? null
                                            : Number(selectedStageScoringLossDraft)
                                        }
                                        onValueChange={(next) =>
                                          setStageScoringLossDrafts((current) => ({
                                            ...current,
                                            [selectedStage.id]: next == null ? "" : String(next)
                                          }))
                                        }
                                      />
                                    </div>
                                  </div>
                                </div>

                                <div className="border-t border-border/40 pt-3 space-y-2">
                                  <div className="flex items-center justify-between">
                                    <h4 className={EYEBROW_CLASS}>Tiebreaker evaluation order</h4>
                                    {selectedStageRankingPresetDraft && (
                                      <Button
                                        type="button"
                                        variant="link"
                                        className="h-auto p-0 text-xs text-primary"
                                        onClick={() => {
                                          handlePresetChange(selectedStage.id, selectedStageRankingPresetDraft);
                                        }}
                                      >
                                        Reset to preset defaults
                                      </Button>
                                    )}
                                  </div>
                                  <div className="flex flex-col gap-1 rounded-lg border border-border/40 bg-background/30 p-2">
                                    {selectedStageTiebreakOrderDraft.map((metricId, index) => {
                                      const metricLabel = ALL_TIEBREAKERS.find(t => t.id === metricId)?.label ?? metricId;
                                      return (
                                        <div key={metricId} className="flex items-center justify-between rounded-md border border-border/30 bg-background/60 px-3 py-1 text-xs">
                                          <span className="font-medium text-muted-foreground">
                                            {index + 1}. <span className="text-foreground">{metricLabel}</span>
                                          </span>
                                          <div className="flex items-center gap-0.5">
                                            <Button
                                              type="button"
                                              variant="ghost"
                                              size="icon"
                                              className="size-6 text-muted-foreground hover:text-foreground"
                                              aria-label={`Move ${metricLabel} up`}
                                              disabled={index === 0}
                                              onClick={() => {
                                                const nextOrder = [...selectedStageTiebreakOrderDraft];
                                                const temp = nextOrder[index - 1];
                                                nextOrder[index - 1] = nextOrder[index];
                                                nextOrder[index] = temp;
                                                setStageTiebreakOrderDrafts((current) => ({
                                                  ...current,
                                                  [selectedStage.id]: nextOrder
                                                }));
                                              }}
                                            >
                                              <ChevronUp className="size-3.5" aria-hidden />
                                            </Button>
                                            <Button
                                              type="button"
                                              variant="ghost"
                                              size="icon"
                                              className="size-6 text-muted-foreground hover:text-foreground"
                                              aria-label={`Move ${metricLabel} down`}
                                              disabled={index === selectedStageTiebreakOrderDraft.length - 1}
                                              onClick={() => {
                                                const nextOrder = [...selectedStageTiebreakOrderDraft];
                                                const temp = nextOrder[index + 1];
                                                nextOrder[index + 1] = nextOrder[index];
                                                nextOrder[index] = temp;
                                                setStageTiebreakOrderDrafts((current) => ({
                                                  ...current,
                                                  [selectedStage.id]: nextOrder
                                                }));
                                              }}
                                            >
                                              <ChevronDown className="size-3.5" aria-hidden />
                                            </Button>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              </>
                            )}

                            <div className="space-y-3 border-t border-border/40 pt-3">
                              <div className="flex items-center justify-between gap-2">
                                <h4 className="text-xs font-semibold">Best-of per round</h4>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={applyBestOfMutation.isPending}
                                  onClick={() => applyBestOfMutation.mutate(selectedStage.id)}
                                >
                                  {applyBestOfMutation.isPending &&
                                  applyBestOfMutation.variables === selectedStage.id ? (
                                    <Loader2 className="size-4 animate-spin" aria-hidden />
                                  ) : null}
                                  Apply to existing matches
                                </Button>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                Baked into matches on (re)generation. Use &quot;Apply to existing
                                matches&quot; to backfill without regenerating.
                                {isDoubleElimination
                                  ? " Upper and lower bracket rounds are configured separately."
                                  : ""}
                              </p>
                              <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                  <Label htmlFor={bestOfDefaultId} className="text-xs text-muted-foreground">
                                    Default
                                  </Label>
                                  <Select
                                    value={
                                      selectedBestOfDraft.default != null
                                        ? String(selectedBestOfDraft.default)
                                        : "inherit"
                                    }
                                    onValueChange={(value) =>
                                      updateBestOfDraft({
                                        default: value === "inherit" ? undefined : Number(value)
                                      })
                                    }
                                  >
                                    <SelectTrigger id={bestOfDefaultId}>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="inherit">Default (Bo3)</SelectItem>
                                      {BEST_OF_OPTIONS.map((n) => (
                                        <SelectItem key={n} value={String(n)}>{`Bo${n}`}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-1">
                                  <Label htmlFor={bestOfFinalId} className="text-xs text-muted-foreground">
                                    {isDoubleElimination ? "Grand Final" : "Final"}
                                  </Label>
                                  <Select
                                    value={
                                      selectedBestOfDraft.final != null
                                        ? String(selectedBestOfDraft.final)
                                        : "none"
                                    }
                                    onValueChange={(value) =>
                                      updateBestOfDraft({
                                        final: value === "none" ? undefined : Number(value)
                                      })
                                    }
                                  >
                                    <SelectTrigger id={bestOfFinalId}>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="none">
                                        {isDoubleElimination
                                          ? "Same as upper bracket"
                                          : "Same as rounds"}
                                      </SelectItem>
                                      {BEST_OF_OPTIONS.map((n) => (
                                        <SelectItem key={n} value={String(n)}>{`Bo${n}`}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>
                              {bestOfRoundSections.map((section) => (
                                <div key={section.key} className="space-y-2">
                                  {section.label ? (
                                    <h5 className="text-xs font-medium text-muted-foreground">
                                      {section.label}
                                    </h5>
                                  ) : null}
                                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                    {section.rounds.map(({ round, label }) => {
                                      const value = selectedBestOfDraft.by_round?.[String(round)];
                                      const roundFieldId = `${fieldIdPrefix}-best-of-round-${round}`;
                                      return (
                                        <div key={round} className="space-y-1">
                                          <Label
                                            htmlFor={roundFieldId}
                                            className="text-xs text-muted-foreground"
                                          >
                                            {label}
                                          </Label>
                                          <Select
                                            value={value != null ? String(value) : "inherit"}
                                            onValueChange={(next) =>
                                              updateBestOfRound(
                                                round,
                                                next === "inherit" ? undefined : Number(next)
                                              )
                                            }
                                          >
                                            <SelectTrigger id={roundFieldId}>
                                              <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                              <SelectItem value="inherit">Default</SelectItem>
                                              {BEST_OF_OPTIONS.map((n) => (
                                                <SelectItem
                                                  key={n}
                                                  value={String(n)}
                                                >{`Bo${n}`}</SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>

                            <div className="border-t border-border/40 pt-3 flex justify-end">
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={updateStageMutation.isPending}
                                onClick={() => {
                                  const scoring: NonNullable<StageSettings["scoring"]> = {};
                                  if (selectedStageScoringWinDraft !== "") scoring.win = Number(selectedStageScoringWinDraft);
                                  if (selectedStageScoringDrawDraft !== "") scoring.draw = Number(selectedStageScoringDrawDraft);
                                  if (selectedStageScoringLossDraft !== "") scoring.loss = Number(selectedStageScoringLossDraft);

                                  const nextSettings: StageSettings = {
                                    ...selectedStageSettings,
                                    ranking_preset: selectedStageRankingPresetDraft === "default" ? undefined : (selectedStageRankingPresetDraft || undefined),
                                    tiebreak_order: selectedStageTiebreakOrderDraft,
                                    scoring: Object.keys(scoring).length > 0 ? scoring : undefined,
                                    swiss_bye_points: selectedStageSwissByePointsDraft !== "" ? Number(selectedStageSwissByePointsDraft) : undefined
                                  };

                                  if (!nextSettings.ranking_preset) delete nextSettings.ranking_preset;
                                  if (!nextSettings.scoring) delete nextSettings.scoring;
                                  if (nextSettings.swiss_bye_points === undefined) delete nextSettings.swiss_bye_points;
                                  if (selectedStageTypeDraft === "double_elimination") {
                                    nextSettings.de_grand_final_type = selectedStageDeGfTypeDraft;
                                  } else {
                                    delete nextSettings.de_grand_final_type;
                                  }

                                  const bestOfSettings = buildBestOfSettings(selectedBestOfDraft);
                                  if (bestOfSettings) {
                                    nextSettings.best_of = bestOfSettings;
                                  } else {
                                    delete nextSettings.best_of;
                                  }

                                  updateStageMutation.mutate({
                                    stageId: selectedStage.id,
                                    data: {
                                      stage_type: selectedStageTypeDraft,
                                      max_rounds: maxRoundsDraftValue,
                                      advance_count:
                                        selectedStageAdvanceCountDraft !== ""
                                          ? normalizeMaxRounds(selectedStageAdvanceCountDraft, 1)
                                          : null,
                                      split_lower_bracket:
                                        selectedStageTypeDraft === "double_elimination"
                                          ? selectedStageSplitLbDraft
                                          : false,
                                      settings_json: nextSettings
                                    }
                                  });
                                }}
                              >
                                {updateStageMutation.isPending &&
                                updateStageMutation.variables?.stageId === selectedStage.id ? (
                                  <Loader2 className="size-4 animate-spin" aria-hidden />
                                ) : null}
                                {updateStageMutation.isPending &&
                                updateStageMutation.variables?.stageId === selectedStage.id
                                  ? "Saving…"
                                  : "Save override"}
                              </Button>
                            </div>
                          </div>
                        </CollapsibleContent>
                      </section>
                    </Collapsible>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <EntityFormDialog
        open={createDialogOpen}
        onOpenChange={(open) => {
          setCreateDialogOpen(open);
          if (!open) {
            createMutation.reset();
            resetCreateStageForm();
          }
        }}
        title="Add stage"
        description="Create the next tournament phase and choose its initial generation format."
        submitLabel="Add stage"
        submittingLabel="Adding…"
        onSubmit={handleCreateStageSubmit}
        isSubmitting={createMutation.isPending}
        errorMessage={createMutation.isError ? createMutation.error.message : undefined}
        isDirty={createStageDirty}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-stage-name">Stage name</Label>
            <Input
              id="new-stage-name"
              placeholder="Playoffs, Group A, Finals…"
              value={newStageName}
              onChange={(event) => setNewStageName(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="new-stage-type">Stage type</Label>
            <Select value={newStageType} onValueChange={(value) => setNewStageType(value as StageType)}>
              <SelectTrigger id="new-stage-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(STAGE_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {newStageType === "swiss" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-stage-max-rounds">Swiss max rounds</Label>
              <NumberInput
                id="new-stage-max-rounds"
                integer
                min={1}
                value={newStageMaxRounds === "" ? null : Number(newStageMaxRounds)}
                onValueChange={(next) => setNewStageMaxRounds(next == null ? "" : String(next))}
              />
            </div>
          ) : null}

          {newStageType === "double_elimination" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-stage-grand-final">Grand final format</Label>
              <Select
                value={newStageDeGrandFinalType}
                onValueChange={(value) =>
                  setNewStageDeGrandFinalType(value as "no_reset" | "with_reset")
                }
              >
                <SelectTrigger id="new-stage-grand-final">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="no_reset">No reset · UB winner wins after one GF win</SelectItem>
                  <SelectItem value="with_reset">
                    With reset · LB champion can force a rematch
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>
      </EntityFormDialog>

      <DeleteConfirmDialog
        open={Boolean(stageToDelete)}
        onOpenChange={(open) => {
          if (!open) setStageToDelete(null);
        }}
        onConfirm={() => {
          if (stageToDelete) {
            deleteMutation.mutate(stageToDelete.id);
          }
        }}
        title="Delete stage"
        description={
          stageToDelete
            ? `Delete "${stageToDelete.name}"? This removes its structure and generated bracket data.`
            : undefined
        }
        cascadeInfo={["Stage structure items", "Team input slots", "Generated stage matches"]}
        isDeleting={deleteMutation.isPending}
      />

      <DeleteConfirmDialog
        open={Boolean(seedStageConfirm)}
        onOpenChange={(open) => {
          if (!open) setSeedStageConfirm(null);
        }}
        onConfirm={() => {
          if (seedStageConfirm) {
            seedTeamsMutation.mutate({ stageId: seedStageConfirm.id, mode: "snake_sr" });
          }
        }}
        title="Reseed stage from SR"
        description={
          seedStageConfirm
            ? `Distribute ${teams.length} teams across ${seedStageConfirm.items.length} group(s) of "${seedStageConfirm.name}" with a snake SR draft. Every manual assignment in this stage is cleared first.`
            : undefined
        }
        cascadeInfo={["Manual team assignments in this stage"]}
        confirmLabel="Seed teams"
        confirmingLabel="Seeding…"
        isDeleting={seedTeamsMutation.isPending}
      />

      <DeleteConfirmDialog
        open={Boolean(mergeStageConfirm)}
        onOpenChange={(open) => {
          if (!open) setMergeStageConfirm(null);
        }}
        onConfirm={() => {
          if (mergeStageConfirm) {
            mergeGroupStagesMutation.mutate({
              targetStageId: mergeStageConfirm.id,
              sourceStageIds: mergeableGroupStageCandidates.map((stage) => stage.id),
              targetName: mergedStageName
            });
          }
        }}
        title="Merge group stages"
        description={
          mergeStageConfirm
            ? `Move the groups, matches and standings of ${mergeableGroupStageCandidates.length} stage(s) into "${mergedStageName}". The merged stages leave the timeline.`
            : undefined
        }
        cascadeInfo={mergeableGroupStageCandidates.map((stage) => `Stage "${stage.name}"`)}
        confirmLabel="Merge stages"
        confirmingLabel="Merging…"
        isDeleting={mergeGroupStagesMutation.isPending}
      />

      <DeleteConfirmDialog
        open={Boolean(forceActivateStage)}
        onOpenChange={(open) => {
          if (!open) setForceActivateStage(null);
        }}
        onConfirm={() => {
          if (forceActivateStage) {
            activateAndGenerateMutation.mutate({ stageId: forceActivateStage.id, force: true });
          }
        }}
        title="Activate before upstream stages finish"
        description={
          forceActivateStage
            ? `Upstream stages still have pending encounters. Activating "${forceActivateStage.name}" now freezes its seeds from standings that can still change.`
            : undefined
        }
        confirmLabel="Activate anyway"
        confirmingLabel="Activating…"
        confirmVariant="default"
        isDeleting={activateAndGenerateMutation.isPending}
      />

      <DeleteConfirmDialog
        open={Boolean(deactivateStageConfirm)}
        onOpenChange={(open) => {
          if (!open) setDeactivateStageConfirm(null);
        }}
        onConfirm={() => {
          if (deactivateStageConfirm) {
            deactivateMutation.mutate(deactivateStageConfirm.id);
          }
        }}
        title="Revert stage to draft"
        description={
          deactivateStageConfirm
            ? `Revert "${deactivateStageConfirm.name}" back to Draft/preview. This only succeeds while every one of its matches is still unplayed — any reported or in-progress match blocks it.`
            : undefined
        }
        confirmLabel="Revert to draft"
        confirmingLabel="Reverting…"
        confirmVariant="default"
        isDeleting={deactivateMutation.isPending}
      />

      <DeleteConfirmDialog
        open={Boolean(regenerateStageConfirm)}
        onOpenChange={(open) => {
          if (!open) setRegenerateStageConfirm(null);
        }}
        onConfirm={() => {
          if (regenerateStageConfirm) {
            generateMutation.mutate(regenerateStageConfirm.id);
          }
        }}
        title="Generate bracket again"
        description={
          regenerateStageConfirm
            ? `"${regenerateStageConfirm.name}" already has generated matches. Existing matches are left untouched: for a grouped stage, only groups with no matches yet get a new bracket; for a bracket that is still all TBD, the seeded teams are written into it; otherwise this is blocked until you delete its existing matches.`
            : undefined
        }
        confirmLabel="Generate"
        confirmingLabel="Generating…"
        confirmVariant="default"
        isDeleting={generateMutation.isPending}
      />
    </>
  );
}
