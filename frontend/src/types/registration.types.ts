export interface CustomFieldDefinition {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "checkbox" | "url";
  required: boolean;
  placeholder: string | null;
  options: string[] | null;
}

export interface BuiltInFieldConfig {
  enabled: boolean;
  required: boolean;
  subroles?: Record<string, string[]>;
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
  status: "pending" | "approved" | "rejected" | "withdrawn";
  submitted_at: string | null;
  reviewed_at: string | null;
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
