import type { ReactNode } from "react";
import type { useTranslations } from "next-intl";

import type { Registration } from "@/types/registration.types";
import { identityProvider } from "@/lib/forms/builtin-keys";
import type { FormField, RolesParams } from "@/types/forms.types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Translator = ReturnType<typeof useTranslations<never>>;

export interface ColumnDefinition {
  id: string;
  label: string;
  category: "meta" | "built_in" | "custom";
  defaultVisible: boolean;
  render: (reg: Registration, index: number) => ReactNode;
  searchValue?: (reg: Registration) => string | null;
  /** Breakpoint at which column becomes visible. "always" = never hidden. */
  responsive?: "always" | "sm" | "md" | "lg";
  /** Optional fixed width class for the column. */
  widthClass?: string;
  /**
   * Content class driving the desktop grid track minimum. Every row is its own
   * grid, so tracks must be sized from a declared content class instead of
   * `min-content`, which would resolve differently per row and misalign the
   * columns. Omitted = `"data"`.
   */
  width?: "icon" | "badge" | "data";
  /** Optional alignment override for header and cells. */
  align?: "left" | "center";
}

/**
 * The roster's identity columns have provider-independent ids: whichever game owns the tournament, its
 * primary handle is `_identity` (mandatory) and the handles after it `_identity_extras` (organizers only),
 * so a saved column choice and the mandatory set never depend on a provider name.
 */
export const IDENTITY_COLUMN_ID = "_identity";
export const IDENTITY_EXTRAS_COLUMN_ID = "_identity_extras";

/**
 * The site's own name for a question the schema labels in the organizer's
 * words. A key with no entry here keeps whatever label the form carries.
 */
export function getLocalizedColumnLabel(t: Translator, key: string, fallback: string): string {
  // Every `identity_<provider>` question is named by its provider, Battle.net
  // included, so the six of them share one line rather than six cases.
  const provider = identityProvider(key);
  if (provider) return t(`registration.accounts.${provider}`);
  switch (key) {
    // Not an identity key of its own: the handles after the primary one, split
    // out of the owner provider's identity answer into a column of their own.
    case IDENTITY_EXTRAS_COLUMN_ID:
      return t("registration.accounts.smurfs");
    case "roles":
      return t("common.rolesList");
    case "top_heroes":
      return t("tournamentDetail.topHeroes");
    case "stream_pov":
      return t("registration.details.streamPov");
    case "public_notes":
      return t("registration.details.notes");
    case "reserve":
      return t("registration.details.reserve");
    default:
      return fallback;
  }
}

/** Whether the `roles` question also asks for top heroes. */
export function asksTopHeroes(field: FormField): boolean {
  return (field.params as Partial<RolesParams>).top_heroes?.enabled === true;
}
