import type { Schema } from "@/types/api";

/** A self-declared game handle, not proof of ownership or authentication. */
export type PlayerIdentity = Schema<"tournament.PlayerIdentityRead">;
