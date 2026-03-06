export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type?: "bearer" | string;
}

export interface AuthUser {
  id: number;
  email: string;
  username: string;
  first_name?: string | null;
  last_name?: string | null;
  avatar_url?: string | null;
  is_active: boolean;
  is_superuser: boolean;
  is_verified: boolean;
  roles: string[];
  permissions: string[];
  created_at: string;
  updated_at?: string | null;
}

export interface LinkedPlayer {
  player_id: number;
  player_name: string;
  is_primary: boolean;
  linked_at: string;
}

export type OAuthProviderName = "discord" | "twitch" | "battlenet";

export interface OAuthProviderAvailability {
  provider: OAuthProviderName;
}

export interface OAuthConnection {
  provider: OAuthProviderName;
  provider_user_id: string;
  email?: string | null;
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
  raw_data?: Record<string, unknown>;
}
