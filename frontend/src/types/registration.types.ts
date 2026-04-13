export interface CustomFieldDefinition {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "checkbox" | "url";
  required: boolean;
  placeholder: string | null;
  options: string[] | null;
  validation?: FieldValidationConfig | null;
}

export interface FieldValidationConfig {
  regex?: string | null;
  error_message?: string | null;
}

export interface BuiltInFieldConfig {
  enabled: boolean;
  required: boolean;
  subroles?: Record<string, string[]>;
  validation?: FieldValidationConfig | null;
}

export interface RegistrationForm {
  id: number;
  tournament_id: number;
  workspace_id: number;
  is_open: boolean;
  opens_at: string | null;
  closes_at: string | null;
  built_in_fields: Record<string, BuiltInFieldConfig>;
  custom_fields: CustomFieldDefinition[];
}

export type RegistrationStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "withdrawn"
  | "banned"
  | "insufficient_data";

export interface TournamentHistoryEntry {
  tournament_id: number;
  tournament_name: string;
  role: string | null;
  division: number | null;
}

export interface Registration {
  id: number;
  tournament_id: number;
  workspace_id: number;
  auth_user_id: number | null;
  user_id: number | null;
  battle_tag: string | null;
  smurf_tags_json: string[] | null;
  discord_nick: string | null;
  twitch_nick: string | null;
  stream_pov: boolean;
  roles: RegistrationRole[];
  notes: string | null;
  custom_fields_json: Record<string, unknown> | null;
  status: RegistrationStatus;
  submitted_at: string | null;
  reviewed_at: string | null;
  tournament_history?: TournamentHistoryEntry[];
}

export interface RegistrationRole {
  role: string;
  subrole: string | null;
  is_primary: boolean;
  priority: number;
}

export interface RoleInput {
  role: string;
  subrole?: string;
  is_primary: boolean;
}

export interface RegistrationCreateInput {
  battle_tag?: string;
  smurf_tags?: string[];
  discord_nick?: string;
  twitch_nick?: string;
  roles?: RoleInput[];
  stream_pov?: boolean;
  notes?: string;
  custom_fields?: Record<string, unknown>;
}

export interface RegistrationUpdateInput {
  battle_tag?: string;
  discord_nick?: string;
  twitch_nick?: string;
  primary_role?: string;
  stream_pov?: boolean;
  notes?: string;
  custom_fields?: Record<string, unknown>;
}
