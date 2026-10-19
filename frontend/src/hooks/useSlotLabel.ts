"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";

import { slotLabel, type RoleOntology } from "@/lib/roster/ontology";

/**
 * Names a roster slot code for display: the owner game's own role name from its scoped ontology, the shared
 * "Flex" label for the open slot, or the raw code for a role the scope does not know (never a guessed one).
 * `ontology` is the owner's — pass `null` while it loads and codes render raw rather than another game's names.
 */
export function useSlotLabel(ontology: RoleOntology | null | undefined): (code: string) => string {
  const t = useTranslations("rosterShape.slotCodes");
  const openLabel = t("flex");
  return useCallback((code: string) => slotLabel(ontology, code, openLabel), [ontology, openLabel]);
}
