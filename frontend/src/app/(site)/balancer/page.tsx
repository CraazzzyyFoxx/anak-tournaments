"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleHelp, Clipboard, FileJson, Loader2, Settings2, Upload } from "lucide-react";

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
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { cn } from "@/lib/utils";
import balancerService from "@/services/balancer.service";
import { BalanceJobEvent, BalanceJobProgress, BalancerConfig } from "@/types/balancer.types";
import BalancerResults from "./components/BalancerResults";

const FALLBACK_CONFIG: BalancerConfig = {
  MASK: { Tank: 1, Damage: 2, Support: 2 },
  POPULATION_SIZE: 200,
  GENERATIONS: 750,
  ELITISM_RATE: 0.2,
  MUTATION_RATE: 0.4,
  MUTATION_STRENGTH: 3,
  MMR_DIFF_WEIGHT: 3,
  DISCOMFORT_WEIGHT: 0.25,
  INTRA_TEAM_VAR_WEIGHT: 0.8,
  MAX_DISCOMFORT_WEIGHT: 1,
  USE_CAPTAINS: true,
  ROLE_MAPPING: { tank: "Tank", dps: "Damage", damage: "Damage", support: "Support" }
};

const mergeConfig = (...configs: Array<BalancerConfig | undefined>): BalancerConfig => {
  const merged: BalancerConfig = {};

  for (const config of configs) {
    if (!config) {
      continue;
    }

    if (config.MASK) {
      merged.MASK = {
        ...(merged.MASK ?? {}),
        ...config.MASK
      };
    }

    if (config.ROLE_MAPPING) {
      merged.ROLE_MAPPING = {
        ...(merged.ROLE_MAPPING ?? {}),
        ...config.ROLE_MAPPING
      };
    }

    for (const [key, value] of Object.entries(config)) {
      if (key === "MASK" || key === "ROLE_MAPPING") {
        continue;
      }
      if (value !== undefined) {
        merged[key as keyof BalancerConfig] = value as never;
      }
    }
  }

  return merged;
};

const mergeStrategyConfig = (base: BalancerConfig, ...configs: Array<BalancerConfig | undefined>): BalancerConfig => {
  const merged: BalancerConfig = {
    ...base,
    MASK: { ...(base.MASK ?? {}) },
    ROLE_MAPPING: { ...(base.ROLE_MAPPING ?? {}) }
  };

  for (const config of configs) {
    if (!config) {
      continue;
    }

    for (const [key, value] of Object.entries(config)) {
      if (key === "MASK" || key === "USE_CAPTAINS" || key === "ROLE_MAPPING") {
        continue;
      }

      if (value !== undefined) {
        merged[key as keyof BalancerConfig] = value as never;
      }
    }
  }

  return merged;
};

const formatPercent = (progress: BalanceJobProgress | null | undefined): string | null => {
  if (!progress) {
    return null;
  }

  if (typeof progress.percent === "number") {
    return `${progress.percent.toFixed(1)}%`;
  }

  if (typeof progress.current === "number" && typeof progress.total === "number" && progress.total > 0) {
    return `${((progress.current / progress.total) * 100).toFixed(1)}%`;
  }

  return null;
};

type LogFilter = "all" | "info" | "warn" | "error";

const normalizeLogLevel = (level: string): string => level.trim().toLowerCase();

const formatStageLabel = (stage: string): string =>
  stage
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

const getLogLevelClassName = (level: string): string => {
  const normalized = normalizeLogLevel(level);

  if (normalized === "error") {
    return "text-destructive";
  }

  if (normalized === "warn" || normalized === "warning") {
    return "text-amber-600";
  }

  return "text-muted-foreground";
};

const PRESET_METADATA: Record<string, { label: string; description: string }> = {
  DEFAULT: {
    label: "Standard Balance",
    description: "Balanced speed and quality for most tournaments."
  },
  COMPETITIVE: {
    label: "Competitive Fairness",
    description: "Prioritizes MMR parity for tournament-level fairness."
  },
  CASUAL: {
    label: "Casual Comfort",
    description: "Keeps balancing quick while reducing off-role discomfort."
  },
  QUICK: {
    label: "Quick Draft",
    description: "Fastest run with fewer optimization iterations."
  },
  PREFERENCE_FOCUSED: {
    label: "Preference Priority",
    description: "Maximizes preferred roles, with lighter MMR pressure."
  },
  HIGH_QUALITY: {
    label: "High Quality",
    description: "Highest-quality optimization, but slower runtime."
  },
  CUSTOM: {
    label: "Custom",
    description: "Manual settings with your own parameter mix."
  }
};

const getPresetMetadata = (preset: string): { label: string; description: string } => {
  const knownPreset = PRESET_METADATA[preset];
  if (knownPreset) {
    return knownPreset;
  }

  return {
    label: formatStageLabel(preset),
    description: "Preset provided by backend configuration."
  };
};

const ADVANCED_FIELD_HELP: Record<string, string> = {
  population:
    "Number of candidate team sets per generation. Higher values improve quality but increase runtime.",
  generations: "How many optimization rounds to run. More generations usually improve balance.",
  elitism:
    "Fraction of top candidates copied as-is to the next generation. Higher values stabilize but reduce exploration.",
  mutationRate: "Chance to mutate a candidate each generation. Higher values explore more possibilities.",
  mutationStrength: "How strongly a mutation reshuffles players when it happens.",
  mmrWeight: "Penalty for MMR gap between teams. Increase for tighter skill parity.",
  discomfortWeight: "Penalty for assigning players away from preferred roles.",
  intraWeight: "Penalty for uneven skill spread within the same team.",
  maxDiscomfortWeight: "Extra penalty for the most uncomfortable player to protect role outliers."
};

interface AdvancedFieldLabelProps {
  htmlFor: string;
  label: string;
  tooltip: string;
}

const AdvancedFieldLabel = ({ htmlFor, label, tooltip }: AdvancedFieldLabelProps) => (
  <div className="flex items-center gap-1.5">
    <Label htmlFor={htmlFor}>{label}</Label>
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label={`${label} help`}
        >
          <CircleHelp className="h-3.5 w-3.5" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs leading-relaxed">{tooltip}</TooltipContent>
    </Tooltip>
  </div>
);

const BalancerPage = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<string>("DEFAULT");
  const [config, setConfig] = useState<BalancerConfig>(FALLBACK_CONFIG);

  const [jobId, setJobId] = useState<string | null>(null);
  const [streamEvents, setStreamEvents] = useState<BalanceJobEvent[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isStreamConnected, setIsStreamConnected] = useState(false);
  const [isAdvancedDialogOpen, setIsAdvancedDialogOpen] = useState(false);
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const [logFilter, setLogFilter] = useState<LogFilter>("all");
  const [autoScrollLogs, setAutoScrollLogs] = useState(true);
  const [copiedLogs, setCopiedLogs] = useState(false);
  const logsContainerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamDisconnectRef = useRef<(() => void) | null>(null);

  const {
    data: configData,
    isError: isConfigError,
    error: configError,
    isLoading: isConfigLoading
  } = useQuery({
    queryKey: ["balancer-config"],
    queryFn: () => balancerService.getConfig(),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    retry: 1
  });

  useEffect(() => {
    if (!configData?.defaults) {
      return;
    }

    setConfig(mergeConfig(FALLBACK_CONFIG, configData.defaults));
    setSelectedPreset("DEFAULT");
  }, [configData]);

  const availablePresets = useMemo(() => Object.keys(configData?.presets ?? {}), [configData]);
  const presetOptions = useMemo(
    () => Array.from(new Set(["DEFAULT", ...availablePresets.filter((preset) => preset !== "DEFAULT"), "CUSTOM"])),
    [availablePresets]
  );
  const selectedPresetMetadata = useMemo(() => getPresetMetadata(selectedPreset), [selectedPreset]);

  const {
    mutate: createJob,
    isPending: isCreatingJob,
    isError: isCreateJobError,
    error: createJobError,
    reset: resetCreateJob
  } = useMutation({
    mutationFn: (payload: { file: File; config: BalancerConfig }) =>
      balancerService.createBalanceJob(payload.file, payload.config),
    onSuccess: (payload) => {
      setJobId(payload.job_id);
    }
  });

  const {
    data: jobStatus,
    isError: isJobStatusError,
    error: jobStatusError
  } = useQuery({
    queryKey: ["balancer-job-status", jobId],
    queryFn: () => balancerService.getBalanceJobStatus(jobId as string),
    enabled: Boolean(jobId),
    refetchInterval: (query: { state: { data?: { status?: string } } }) => {
      const status = query.state.data?.status;
      if (status === "succeeded" || status === "failed") {
        return false;
      }
      return 2000;
    },
    refetchIntervalInBackground: true,
    retry: 1
  });

  const {
    data: resultData,
    isFetching: isResultFetching,
    isError: isResultError,
    error: resultError
  } = useQuery({
    queryKey: ["balancer-job-result", jobId],
    queryFn: () => balancerService.getBalanceJobResult(jobId as string),
    enabled: Boolean(jobId && jobStatus?.status === "succeeded"),
    retry: 1
  });

  useEffect(() => {
    if (!jobId) {
      return;
    }

    streamDisconnectRef.current?.();
    streamDisconnectRef.current = null;

    setIsStreamConnected(false);
    setStreamError(null);

    const disconnect = balancerService.streamBalanceJob(jobId, {
      onOpen: () => {
        setIsStreamConnected(true);
      },
      onEvent: (event) => {
        setStreamEvents((previous) => {
          if (previous.some((item) => item.event_id === event.event_id)) {
            return previous;
          }
          const next = [...previous, event].sort((a, b) => a.event_id - b.event_id);
          return next.length > 250 ? next.slice(next.length - 250) : next;
        });
      },
      onError: (message) => {
        setIsStreamConnected(false);
        setStreamError(message);
      }
    });

    streamDisconnectRef.current = disconnect;

    return () => {
      disconnect();

      if (streamDisconnectRef.current === disconnect) {
        streamDisconnectRef.current = null;
      }
    };
  }, [jobId]);

  useEffect(() => {
    if (jobStatus?.status !== "succeeded" && jobStatus?.status !== "failed") {
      return;
    }

    streamDisconnectRef.current?.();
    streamDisconnectRef.current = null;
    setIsStreamConnected(false);
  }, [jobStatus?.status]);

  useEffect(() => {
    if (!autoScrollLogs) {
      return;
    }

    const container = logsContainerRef.current;
    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, [streamEvents, autoScrollLogs]);

  useEffect(() => {
    if (!copiedLogs) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setCopiedLogs(false);
    }, 1500);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [copiedLogs]);

  const latestEvent = streamEvents.length > 0 ? streamEvents[streamEvents.length - 1] : null;
  const activeStage = jobStatus?.stage ?? latestEvent?.stage ?? "idle";
  const activeProgress = jobStatus?.progress ?? latestEvent?.progress;
  const activePercent = formatPercent(activeProgress);
  const computedPercentValue =
    typeof activeProgress?.percent === "number"
      ? activeProgress.percent
      : typeof activeProgress?.current === "number" && typeof activeProgress?.total === "number" && activeProgress.total > 0
        ? (activeProgress.current / activeProgress.total) * 100
        : 0;
  const activePercentValue =
    jobStatus?.status === "succeeded" ? 100 : Math.max(0, Math.min(100, computedPercentValue));
  const isJobRunning = jobStatus?.status === "queued" || jobStatus?.status === "running";
  const playersPerTeam = (config.MASK?.Tank ?? 0) + (config.MASK?.Damage ?? 0) + (config.MASK?.Support ?? 0);

  const filteredStreamEvents = useMemo(() => {
    if (logFilter === "all") {
      return streamEvents;
    }

    return streamEvents.filter((event) => {
      const normalized = normalizeLogLevel(event.level);
      if (logFilter === "warn") {
        return normalized === "warn" || normalized === "warning";
      }

      return normalized === logFilter;
    });
  }, [streamEvents, logFilter]);

  const workflowSteps = [
    {
      id: "upload",
      label: "Upload",
      isDone: Boolean(selectedFile),
      isActive: !selectedFile
    },
    {
      id: "configure",
      label: "Configure",
      isDone: Boolean(selectedFile),
      isActive: Boolean(selectedFile && !jobId)
    },
    {
      id: "run",
      label: "Balance",
      isDone: jobStatus?.status === "succeeded",
      isActive: Boolean(jobId && !resultData)
    },
    {
      id: "results",
      label: "Results",
      isDone: Boolean(resultData),
      isActive: Boolean(resultData)
    }
  ];

  const updateConfigNumber = (key: keyof BalancerConfig, value: string) => {
    if (value.trim() === "") {
      setSelectedPreset("CUSTOM");
      setConfig((prev) => ({
        ...prev,
        [key]: undefined
      }));
      return;
    }

    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      return;
    }

    setSelectedPreset("CUSTOM");
    setConfig((prev) => ({
      ...prev,
      [key]: parsed
    }));
  };

  const updateMask = (role: "Tank" | "Damage" | "Support", value: string) => {
    if (value.trim() === "") {
      setConfig((prev) => ({
        ...prev,
        MASK: {
          ...(prev.MASK ?? {}),
          [role]: 0
        }
      }));
      return;
    }

    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      return;
    }

    setConfig((prev) => ({
      ...prev,
      MASK: {
        ...(prev.MASK ?? {}),
        [role]: parsed
      }
    }));
  };

  const applyPreset = (presetName: string) => {
    setSelectedPreset(presetName);

    if (presetName === "CUSTOM") {
      return;
    }

    const presetConfig = configData?.presets?.[presetName];
    setConfig((previous) => mergeStrategyConfig(previous, configData?.defaults, presetConfig));
  };

  const resetAdvancedSettings = () => {
    if (selectedPreset === "CUSTOM") {
      setSelectedPreset("DEFAULT");
      setConfig((previous) => mergeStrategyConfig(previous, configData?.defaults));
      return;
    }

    setConfig((previous) =>
      mergeStrategyConfig(previous, configData?.defaults, configData?.presets?.[selectedPreset])
    );
  };

  const resetRuntimeState = () => {
    resetCreateJob();
    setJobId(null);
    setStreamEvents([]);
    setStreamError(null);
    setIsStreamConnected(false);
  };

  const applySelectedFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith(".json")) {
      setFileError("Please upload a JSON file (.json).");
      return;
    }

    setFileError(null);
    setSelectedFile(file);
    resetRuntimeState();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    applySelectedFile(file);
  };

  const handleFileDrop = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsFileDragOver(false);

    if (isCreatingJob) {
      return;
    }

    const file = event.dataTransfer.files?.[0];
    if (!file) {
      return;
    }

    applySelectedFile(file);
  };

  const handleSubmit = () => {
    if (!selectedFile) {
      setFileError("Please select a player JSON file before balancing.");
      return;
    }

    setFileError(null);
    resetRuntimeState();

    createJob({
      file: selectedFile,
      config
    });
  };

  const handleCopyLogs = async () => {
    if (filteredStreamEvents.length === 0) {
      return;
    }

    const logText = filteredStreamEvents
      .map((event) => {
        const timestamp = new Date(event.timestamp * 1000).toLocaleTimeString();
        return `[${timestamp}] [${event.level}] [${event.stage}] ${event.message}`;
      })
      .join("\n");

    try {
      await navigator.clipboard.writeText(logText);
      setCopiedLogs(true);
    } catch {
      setStreamError("Could not copy logs to clipboard.");
    }
  };

  const handleReset = () => {
    setSelectedFile(null);
    setSelectedPreset("DEFAULT");
    setConfig(mergeConfig(FALLBACK_CONFIG, configData?.defaults));
    setFileError(null);
    setIsAdvancedDialogOpen(false);
    setIsFileDragOver(false);
    setLogFilter("all");
    setAutoScrollLogs(true);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    resetRuntimeState();
  };

  const runtimeError =
    (isCreateJobError && createJobError) ||
    (isJobStatusError && jobStatusError) ||
    (isResultError && resultError) ||
    (jobStatus?.status === "failed" && jobStatus.error ? new Error(jobStatus.error) : null) ||
    null;

  const streamStatusLabel = isStreamConnected ? "Connected" : isJobRunning ? "Reconnecting" : "Closed";

  const progressSteps = [
    {
      key: "queued",
      label: "Queued",
      isDone: Boolean(jobId),
      isActive: jobStatus?.status === "queued"
    },
    {
      key: "running",
      label: "Running",
      isDone: jobStatus?.status === "running" || jobStatus?.status === "succeeded" || jobStatus?.status === "failed",
      isActive: jobStatus?.status === "running"
    },
    {
      key: "complete",
      label: jobStatus?.status === "failed" ? "Failed" : "Complete",
      isDone: jobStatus?.status === "succeeded" || jobStatus?.status === "failed",
      isActive: jobStatus?.status === "succeeded" || jobStatus?.status === "failed"
    }
  ];

  return (
    <div className="container space-y-8 p-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Tournament Team Balancer</h1>
        <p className="text-sm text-muted-foreground">
          Upload player data, tune balancing behavior, and track the live optimization progress.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {workflowSteps.map((step, index) => (
          <div
            key={step.id}
            className={cn(
              "rounded-lg border p-3",
              step.isDone && "border-primary/40 bg-primary/5",
              step.isActive && !step.isDone && "border-primary/30"
            )}
          >
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Step {index + 1}</p>
              {step.isDone ? (
                <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />
              ) : (
                <Badge variant={step.isActive ? "secondary" : "outline"}>
                  {step.isActive ? "Active" : "Pending"}
                </Badge>
              )}
            </div>
            <p className="text-sm font-medium">{step.label}</p>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileJson className="h-5 w-5" />
            Upload Player Data
          </CardTitle>
          <CardDescription>
            Start with a preset, adjust team composition, then run the balancer on your JSON roster.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <div className="space-y-4 rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <Settings2 className="h-4 w-4" />
                <h3 className="text-sm font-semibold">Balancing Settings</h3>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3 rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-medium">Balancing preset</h4>
                    <Badge variant={selectedPreset === "CUSTOM" ? "secondary" : "outline"}>
                      {selectedPresetMetadata.label}
                    </Badge>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="preset">Preset</Label>
                    <Select value={selectedPreset} onValueChange={applyPreset}>
                      <SelectTrigger id="preset" disabled={isCreatingJob}>
                        <SelectValue placeholder="Select preset" />
                      </SelectTrigger>
                      <SelectContent>
                        {presetOptions.map((preset) => (
                          <SelectItem key={preset} value={preset}>
                            {getPresetMetadata(preset).label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{selectedPresetMetadata.description}</p>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsAdvancedDialogOpen(true)}
                    disabled={isCreatingJob}
                    className="w-full sm:w-auto"
                  >
                    Advanced settings
                  </Button>

                  <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    Preset controls optimization strategy only. Team composition is configured separately.
                  </div>
                </div>

                <div className="space-y-3 rounded-md border p-3">
                  <h4 className="text-sm font-medium">Team composition</h4>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="mask-tank" className="flex items-center gap-2">
                        <PlayerRoleIcon role="Tank" size={16} />
                        <span>Tank Slots</span>
                      </Label>
                      <Input
                        id="mask-tank"
                        type="number"
                        min={0}
                        value={config.MASK?.Tank ?? 0}
                        onChange={(e) => updateMask("Tank", e.target.value)}
                        disabled={isCreatingJob}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="mask-damage" className="flex items-center gap-2">
                        <PlayerRoleIcon role="Damage" size={16} />
                        <span>Damage Slots</span>
                      </Label>
                      <Input
                        id="mask-damage"
                        type="number"
                        min={0}
                        value={config.MASK?.Damage ?? 0}
                        onChange={(e) => updateMask("Damage", e.target.value)}
                        disabled={isCreatingJob}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="mask-support" className="flex items-center gap-2">
                        <PlayerRoleIcon role="Support" size={16} />
                        <span>Support Slots</span>
                      </Label>
                      <Input
                        id="mask-support"
                        type="number"
                        min={0}
                        value={config.MASK?.Support ?? 0}
                        onChange={(e) => updateMask("Support", e.target.value)}
                        disabled={isCreatingJob}
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="captains"
                      checked={Boolean(config.USE_CAPTAINS)}
                      onCheckedChange={(checked) => {
                        setConfig((prev) => ({
                          ...prev,
                          USE_CAPTAINS: checked === true
                        }));
                      }}
                      disabled={isCreatingJob}
                    />
                    <Label htmlFor="captains" className="cursor-pointer">
                      Use captains when assigning teams
                    </Label>
                  </div>

                  <p className="text-xs text-muted-foreground">Players per team: {playersPerTeam}</p>
                </div>
              </div>

              {isConfigLoading && (
                <div className="text-xs text-muted-foreground" aria-live="polite">
                  Loading runtime balancer defaults...
                </div>
              )}
            </div>

            <Dialog open={isAdvancedDialogOpen} onOpenChange={setIsAdvancedDialogOpen}>
              <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                  <DialogTitle>Advanced balancing settings</DialogTitle>
                  <DialogDescription>
                    Fine-tune the genetic algorithm and cost function used by the balancer.
                  </DialogDescription>
                </DialogHeader>

                <TooltipProvider delayDuration={120}>
                  <div className="max-h-[65vh] overflow-y-auto pr-1">
                    <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <AdvancedFieldLabel
                        htmlFor="population"
                        label="Population Size"
                        tooltip={ADVANCED_FIELD_HELP.population}
                      />
                      <Input
                        id="population"
                        type="number"
                        min={configData?.limits?.POPULATION_SIZE?.min ?? 10}
                        max={configData?.limits?.POPULATION_SIZE?.max ?? 1000}
                        value={config.POPULATION_SIZE ?? ""}
                        onChange={(e) => updateConfigNumber("POPULATION_SIZE", e.target.value)}
                        disabled={isCreatingJob}
                      />
                      <p className="text-xs text-muted-foreground">
                        {configData?.limits?.POPULATION_SIZE
                          ? `Range: ${configData.limits.POPULATION_SIZE.min}-${configData.limits.POPULATION_SIZE.max}`
                          : "Larger values improve search quality but run slower."}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <AdvancedFieldLabel
                        htmlFor="generations"
                        label="Generations"
                        tooltip={ADVANCED_FIELD_HELP.generations}
                      />
                      <Input
                        id="generations"
                        type="number"
                        min={configData?.limits?.GENERATIONS?.min ?? 10}
                        max={configData?.limits?.GENERATIONS?.max ?? 5000}
                        value={config.GENERATIONS ?? ""}
                        onChange={(e) => updateConfigNumber("GENERATIONS", e.target.value)}
                        disabled={isCreatingJob}
                      />
                      <p className="text-xs text-muted-foreground">
                        {configData?.limits?.GENERATIONS
                          ? `Range: ${configData.limits.GENERATIONS.min}-${configData.limits.GENERATIONS.max}`
                          : "More generations usually produce better balance."}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <AdvancedFieldLabel
                        htmlFor="elitism"
                        label="Elitism Rate"
                        tooltip={ADVANCED_FIELD_HELP.elitism}
                      />
                      <Input
                        id="elitism"
                        type="number"
                        min={0}
                        max={1}
                        step={0.01}
                        value={config.ELITISM_RATE ?? ""}
                        onChange={(e) => updateConfigNumber("ELITISM_RATE", e.target.value)}
                        disabled={isCreatingJob}
                      />
                    </div>

                    <div className="space-y-2">
                      <AdvancedFieldLabel
                        htmlFor="mutation-rate"
                        label="Mutation Rate"
                        tooltip={ADVANCED_FIELD_HELP.mutationRate}
                      />
                      <Input
                        id="mutation-rate"
                        type="number"
                        min={0}
                        max={1}
                        step={0.01}
                        value={config.MUTATION_RATE ?? ""}
                        onChange={(e) => updateConfigNumber("MUTATION_RATE", e.target.value)}
                        disabled={isCreatingJob}
                      />
                    </div>

                    <div className="space-y-2">
                      <AdvancedFieldLabel
                        htmlFor="mutation-strength"
                        label="Mutation Strength"
                        tooltip={ADVANCED_FIELD_HELP.mutationStrength}
                      />
                      <Input
                        id="mutation-strength"
                        type="number"
                        min={1}
                        max={10}
                        value={config.MUTATION_STRENGTH ?? ""}
                        onChange={(e) => updateConfigNumber("MUTATION_STRENGTH", e.target.value)}
                        disabled={isCreatingJob}
                      />
                    </div>

                    <div className="space-y-2">
                      <AdvancedFieldLabel
                        htmlFor="mmr-weight"
                        label="MMR Weight"
                        tooltip={ADVANCED_FIELD_HELP.mmrWeight}
                      />
                      <Input
                        id="mmr-weight"
                        type="number"
                        min={0}
                        step={0.1}
                        value={config.MMR_DIFF_WEIGHT ?? ""}
                        onChange={(e) => updateConfigNumber("MMR_DIFF_WEIGHT", e.target.value)}
                        disabled={isCreatingJob}
                      />
                    </div>

                    <div className="space-y-2">
                      <AdvancedFieldLabel
                        htmlFor="discomfort-weight"
                        label="Discomfort Weight"
                        tooltip={ADVANCED_FIELD_HELP.discomfortWeight}
                      />
                      <Input
                        id="discomfort-weight"
                        type="number"
                        min={0}
                        step={0.01}
                        value={config.DISCOMFORT_WEIGHT ?? ""}
                        onChange={(e) => updateConfigNumber("DISCOMFORT_WEIGHT", e.target.value)}
                        disabled={isCreatingJob}
                      />
                    </div>

                    <div className="space-y-2">
                      <AdvancedFieldLabel
                        htmlFor="intra-weight"
                        label="Intra Team Variance Weight"
                        tooltip={ADVANCED_FIELD_HELP.intraWeight}
                      />
                      <Input
                        id="intra-weight"
                        type="number"
                        min={0}
                        step={0.01}
                        value={config.INTRA_TEAM_VAR_WEIGHT ?? ""}
                        onChange={(e) => updateConfigNumber("INTRA_TEAM_VAR_WEIGHT", e.target.value)}
                        disabled={isCreatingJob}
                      />
                    </div>

                    <div className="space-y-2 md:col-span-2">
                      <AdvancedFieldLabel
                        htmlFor="max-discomfort"
                        label="Max Discomfort Weight"
                        tooltip={ADVANCED_FIELD_HELP.maxDiscomfortWeight}
                      />
                      <Input
                        id="max-discomfort"
                        type="number"
                        min={0}
                        step={0.01}
                        value={config.MAX_DISCOMFORT_WEIGHT ?? ""}
                        onChange={(e) => updateConfigNumber("MAX_DISCOMFORT_WEIGHT", e.target.value)}
                        disabled={isCreatingJob}
                      />
                    </div>
                    </div>
                  </div>
                </TooltipProvider>

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={resetAdvancedSettings}
                    disabled={isCreatingJob}
                  >
                    {selectedPreset === "CUSTOM" ? "Reset to defaults" : "Reset to preset"}
                  </Button>
                  <Button type="button" onClick={() => setIsAdvancedDialogOpen(false)}>
                    Done
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {!isConfigLoading && (
              <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 text-xs lg:grid-cols-2">
                <div className="space-y-1 rounded-md border bg-background p-3">
                  <p className="text-muted-foreground">Team composition</p>
                  <p className="font-medium">
                    T {config.MASK?.Tank ?? 0} / D {config.MASK?.Damage ?? 0} / S {config.MASK?.Support ?? 0}
                  </p>
                  <p className="text-muted-foreground">
                    Players per team: <span className="font-medium text-foreground">{playersPerTeam}</span>
                  </p>
                  <p className="text-muted-foreground">
                    Captains: <span className="font-medium text-foreground">{config.USE_CAPTAINS ? "Enabled" : "Disabled"}</span>
                  </p>
                </div>
                <div className="space-y-1 rounded-md border bg-background p-3">
                  <p className="text-muted-foreground">Optimization strategy</p>
                  <p className="font-medium">{selectedPresetMetadata.label}</p>
                  <p className="text-muted-foreground">Population / Generations</p>
                  <p className="font-medium">
                    {config.POPULATION_SIZE ?? "-"} / {config.GENERATIONS ?? "-"}
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <Input
                id="players-file"
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileChange}
                disabled={isCreatingJob}
                className="sr-only"
              />
              <Label
                htmlFor="players-file"
                onDragEnter={(event) => {
                  event.preventDefault();
                  if (!isCreatingJob) {
                    setIsFileDragOver(true);
                  }
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (!isCreatingJob) {
                    setIsFileDragOver(true);
                  }
                }}
                onDragLeave={() => {
                  setIsFileDragOver(false);
                }}
                onDrop={handleFileDrop}
                className={cn(
                  "flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-center transition-colors",
                  isFileDragOver && "border-primary bg-primary/5",
                  isCreatingJob && "cursor-not-allowed opacity-70"
                )}
              >
                <Upload className="h-5 w-5 text-muted-foreground" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    {selectedFile ? selectedFile.name : "Drop a JSON file here or click to browse"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {selectedFile
                      ? `${(selectedFile.size / 1024).toFixed(2)} KB`
                      : "Expected roster JSON with player list and role preferences."}
                  </p>
                </div>
              </Label>
              {fileError && (
                <p className="text-xs text-destructive" aria-live="polite">
                  {fileError}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <Button
                onClick={handleSubmit}
                disabled={!selectedFile || isCreatingJob || isJobRunning}
                className="w-full sm:w-auto sm:min-w-[160px]"
              >
                {isCreatingJob ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Queueing...
                  </>
                ) : isJobRunning ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Running...
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    Balance Teams
                  </>
                )}
              </Button>
              {(selectedFile || jobId || resultData) && (
                <Button onClick={handleReset} variant="outline" className="w-full sm:w-auto">
                  Reset
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {jobId && (
        <Card>
          <CardHeader>
            <CardTitle>Balancing Progress</CardTitle>
            <CardDescription>Job ID: {jobId}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 grid gap-3 md:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Status</p>
                <Badge variant={jobStatus?.status === "failed" ? "destructive" : "secondary"} className="mt-1">
                  {jobStatus?.status ?? "queued"}
                </Badge>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Stage</p>
                <p className="mt-1 text-sm font-medium">{formatStageLabel(activeStage)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Stream</p>
                <p className="mt-1 text-sm font-medium">{streamStatusLabel}</p>
              </div>
            </div>

            <div className="mb-5 space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {typeof activeProgress?.current === "number" && typeof activeProgress.total === "number"
                    ? `${activeProgress.current}/${activeProgress.total}`
                    : "In progress"}
                </span>
                <span>{activePercent ?? `${activePercentValue.toFixed(1)}%`}</span>
              </div>
              <Progress value={activePercentValue} aria-label="Balancer progress" />
            </div>

            <div className="mb-5 grid gap-2 sm:grid-cols-3">
              {progressSteps.map((step) => (
                <div
                  key={step.key}
                  className={cn(
                    "rounded-md border px-3 py-2 text-xs",
                    step.isDone && "border-primary/40 bg-primary/5",
                    step.isActive && !step.isDone && "border-primary/30"
                  )}
                >
                  <p className="font-medium">{step.label}</p>
                </div>
              ))}
            </div>

            <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">Live logs</p>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={logFilter} onValueChange={(value) => setLogFilter(value as LogFilter)}>
                  <SelectTrigger className="h-8 w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All levels</SelectItem>
                    <SelectItem value="info">Info</SelectItem>
                    <SelectItem value="warn">Warnings</SelectItem>
                    <SelectItem value="error">Errors</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant={autoScrollLogs ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setAutoScrollLogs((previous) => !previous)}
                >
                  {autoScrollLogs ? "Auto-scroll on" : "Auto-scroll off"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCopyLogs}
                  disabled={filteredStreamEvents.length === 0}
                >
                  <Clipboard className="h-3.5 w-3.5" />
                  {copiedLogs ? "Copied" : "Copy logs"}
                </Button>
              </div>
            </div>

            <div
              ref={logsContainerRef}
              className="max-h-72 overflow-y-auto rounded-md border bg-muted p-3 font-mono text-xs"
              aria-live="polite"
              aria-relevant="additions text"
            >
              {filteredStreamEvents.length === 0 ? (
                <p className="text-muted-foreground">
                  {streamEvents.length === 0 ? "Waiting for job events..." : "No events for selected filter."}
                </p>
              ) : (
                filteredStreamEvents.map((event) => (
                  <div key={event.event_id} className="mb-1">
                    <span className={getLogLevelClassName(event.level)}>
                      [{new Date(event.timestamp * 1000).toLocaleTimeString()}] [{event.level}] [{event.stage}] 
                    </span>
                    <span>{event.message}</span>
                  </div>
                ))
              )}
            </div>

            {streamError && isJobRunning && (
              <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
                {streamError} Stream will retry automatically.
              </p>
            )}
            {isResultFetching && (
              <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
                Fetching final result...
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {isConfigError && (
        <Alert variant="destructive">
          <AlertTitle>Config Error</AlertTitle>
          <AlertDescription>
            {configError instanceof Error
              ? configError.message
              : "Failed to load balancer configuration defaults"}
          </AlertDescription>
        </Alert>
      )}

      {runtimeError && (
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            {runtimeError instanceof Error
              ? runtimeError.message
              : "An error occurred while processing the balancer job"}
          </AlertDescription>
        </Alert>
      )}

      {resultData && <BalancerResults results={resultData} />}
    </div>
  );
};

export default BalancerPage;
