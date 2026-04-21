export interface PlayerData {
  uuid: string;
  name: string;
  assigned_rating: number;
  role_discomfort: number;
  is_captain: boolean;
  is_flex?: boolean;
  role_preferences: string[];
  all_ratings: Record<string, number>;
  sub_role?: string | null;
}

export interface TeamData {
  id: number;
  name: string;
  average_mmr: number;
  rating_variance: number;
  total_discomfort: number;
  max_discomfort: number;
  roster: Record<string, PlayerData[]>;
}

export interface Statistics {
  average_mmr: number;
  mmr_std_dev: number;
  total_teams: number;
  players_per_team: number;
  off_role_count: number;
  sub_role_collision_count: number;
  unbalanced_count: number;
  average_total_rating?: number | null;
  total_rating_std_dev?: number | null;
  max_total_rating_gap?: number | null;
  balance_objective?: number | null;
  comfort_objective?: number | null;
  composite_score?: number | null;
}

export interface BalanceResponse {
  teams: TeamData[];
  statistics: Statistics;
  benched_players?: PlayerData[];
  applied_config?: BalancerConfig | null;
}

export interface BalancerConfig {
  role_mask?: Record<string, number>;
  algorithm?: "moo" | "cpsat" | "mixtura_balancer";
  population_size?: number;
  generation_count?: number;
  mutation_rate?: number;
  mutation_strength?: number;
  average_mmr_balance_weight?: number;
  role_discomfort_weight?: number;
  intra_team_variance_weight?: number;
  max_role_discomfort_weight?: number;
  team_total_balance_weight?: number;
  max_team_gap_weight?: number;
  role_line_balance_weight?: number;
  role_spread_weight?: number;
  intra_team_std_weight?: number;
  internal_role_spread_weight?: number;
  sub_role_collision_weight?: number;
  use_captains?: boolean;
  max_result_variants?: number;
  team_variance_weight?: number;
  team_spread_weight?: number;
  sub_role_penalty_weight?: number;
}

export type BalancerConfigFieldType = "boolean" | "float" | "integer" | "role_mask" | "select";

export interface BalancerConfigField {
  key: keyof BalancerConfig;
  label: string;
  description: string;
  type: BalancerConfigFieldType;
  group: "Roles" | "Algorithm" | "Quality weights" | "Strategy" | "Solver output";
  default: unknown;
  limits?: { min: number; max: number } | null;
  options?: string[];
  applies_to: Array<NonNullable<BalancerConfig["algorithm"]>>;
}

export interface LegacyBalancerConfigField extends Omit<BalancerConfigField, "key"> {
  key: "input_role_mapping";
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

export interface RawBalancerConfigResponse extends Omit<BalancerConfigResponse, "fields"> {
  fields: Array<BalancerConfigField | LegacyBalancerConfigField>;
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
