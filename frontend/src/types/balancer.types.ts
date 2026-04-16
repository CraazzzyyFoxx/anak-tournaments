export interface PlayerData {
  uuid: string;
  name: string;
  rating: number;
  discomfort: number;
  isCaptain: boolean;
  isFlex?: boolean;
  preferences: string[];
  allRatings: Record<string, number>;
}

export interface TeamData {
  id: number;
  name: string;
  avgMMR: number;
  variance: number;
  totalDiscomfort: number;
  maxDiscomfort: number;
  roster: Record<string, PlayerData[]>;
}

export interface Statistics {
  averageMMR: number;
  mmrStdDev: number;
  totalTeams: number;
  playersPerTeam: number;
  offRoleCount?: number;
  subRoleCollisionCount?: number;
  unbalancedCount?: number;
}

export interface BalanceResponse {
  teams: TeamData[];
  statistics: Statistics;
  benchedPlayers?: PlayerData[];
  appliedConfig?: BalancerConfig;
}

export interface BalancerConfig {
  MASK?: Record<string, number>;
  POPULATION_SIZE?: number;
  GENERATIONS?: number;
  ELITISM_RATE?: number;
  MUTATION_RATE?: number;
  MUTATION_STRENGTH?: number;
  MMR_DIFF_WEIGHT?: number;
  DISCOMFORT_WEIGHT?: number;
  INTRA_TEAM_VAR_WEIGHT?: number;
  MAX_DISCOMFORT_WEIGHT?: number;
  USE_CAPTAINS?: boolean;
  ROLE_MAPPING?: Record<string, string>;
  ALGORITHM?: "genetic" | "cpsat";
  MAX_CPSAT_SOLUTIONS?: number;
}

export interface BalanceJobResult {
  variants: BalanceResponse[];
}

export interface BalancerConfigResponse {
  defaults: BalancerConfig;
  limits: Record<string, { min: number; max: number }>;
  presets: Record<string, BalancerConfig>;
}

export type BalanceJobStatus = "queued" | "running" | "succeeded" | "failed";

export interface BalanceJobProgress {
  current?: number;
  total?: number;
  percent?: number;
}

export interface BalanceJobEvent {
  event_id: number;
  timestamp: number;
  level: string;
  status: BalanceJobStatus;
  stage: string;
  message: string;
  progress?: BalanceJobProgress | null;
}

export interface BalanceJobCreateResponse {
  job_id: string;
  status: BalanceJobStatus;
  status_url: string;
  result_url: string;
  stream_url: string;
}

export interface BalanceJobStatusResponse {
  job_id: string;
  status: BalanceJobStatus;
  stage?: string | null;
  created_at: number;
  started_at?: number | null;
  finished_at?: number | null;
  progress?: BalanceJobProgress | null;
  error?: string | null;
  events_count: number;
}
