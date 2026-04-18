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
  STAGNATION_THRESHOLD?: number;
  MMR_DIFF_WEIGHT?: number;
  DISCOMFORT_WEIGHT?: number;
  INTRA_TEAM_VAR_WEIGHT?: number;
  MAX_DISCOMFORT_WEIGHT?: number;
  TEAM_TOTAL_STD_WEIGHT?: number;
  MAX_TEAM_GAP_WEIGHT?: number;
  ROLE_BALANCE_WEIGHT?: number;
  ROLE_SPREAD_WEIGHT?: number;
  INTRA_TEAM_STD_WEIGHT?: number;
  SUBROLE_COLLISION_WEIGHT?: number;
  USE_CAPTAINS?: boolean;
  ROLE_MAPPING?: Record<string, string>;
  ALGORITHM?: "genetic" | "genetic_moo" | "cpsat" | "nsga";
  MAX_CPSAT_SOLUTIONS?: number;
  MAX_GENETIC_SOLUTIONS?: number;
  MAX_NSGA_SOLUTIONS?: number;
  WEIGHT_TEAM_VARIANCE?: number;
  TEAM_SPREAD_BLEND?: number;
  SUBROLE_BLEND?: number;
}

export type BalancerConfigFieldType =
  | "boolean"
  | "float"
  | "integer"
  | "role_mask"
  | "select"
  | "string_map";

export interface BalancerConfigField {
  key: keyof BalancerConfig;
  label: string;
  description: string;
  type: BalancerConfigFieldType;
  group: "Roles" | "Algorithm" | "Quality weights" | "Strategy" | "Solver output";
  default: unknown;
  limits?: { min: number; max: number } | null;
  options?: string[];
  applies_to: Array<NonNullable<BalancerConfig["ALGORITHM"]>>;
}

export interface BalanceJobResult {
  variants: BalanceResponse[];
}

export interface BalancerConfigResponse {
  defaults: BalancerConfig;
  limits: Record<string, { min: number; max: number }>;
  presets: Record<string, BalancerConfig>;
  fields: BalancerConfigField[];
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
