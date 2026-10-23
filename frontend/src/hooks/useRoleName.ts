"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";

import { roleName } from "@/lib/roster/ontology";
import type { OntologyRole } from "@/types/discipline.types";

/**
 * Names an ontology role for display: the localized `common.roles.<code>` message when the bundle has one for this
 * module-declared code, else the ontology's own `name` (the same shape as `useKindLabel` for catalog kinds).
 */
export function useRoleName(): (role: Pick<OntologyRole, "code" | "name" | "workspace_id">) => string {
  const t = useTranslations("common.roles");
  return useCallback(
    (role) => roleName(role, (code) => (t.has(code as never) ? t(code as never) : null)),
    [t]
  );
}
