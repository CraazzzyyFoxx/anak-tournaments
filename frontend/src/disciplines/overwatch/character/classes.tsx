"use client";

import { useCallback, useMemo } from "react";

import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { useRoleName } from "@/hooks/useRoleName";
import { findRole, ratedDimension, roleTint } from "@/lib/roster/ontology";
import type { DisciplineMetadata } from "@/types/discipline.types";

/**
 * A hero's class (`attrs.class`) drawn the Overwatch way: every class code is also a rated role code of the game,
 * so the class borrows that role's localized name, colour and glyph from the game's ontology. Display only — a
 * class never becomes a player's role. An unknown or absent class stays neutral.
 */
export function useHeroClass(metadata: DisciplineMetadata) {
  const nameOf = useRoleName();
  const dimension = ratedDimension(metadata)?.code ?? null;
  const roleOf = useCallback(
    (cls: string | null | undefined) => (cls && dimension ? findRole(metadata, { dimension, role: cls }) : null),
    [metadata, dimension]
  );
  return useMemo(
    () => ({
      label: (cls: string | null | undefined): string => {
        const role = roleOf(cls);
        return role ? nameOf(role) : (cls ?? "");
      },
      color: (cls: string | null | undefined): string => (cls ? roleTint(metadata, cls) : "var(--aqt-fg-muted)"),
      icon: (cls: string | null | undefined, size: number) =>
        roleOf(cls) && dimension ? (
          <PlayerRoleIcon role={{ dimension, role: cls as string }} ontology={metadata} size={size} decorative />
        ) : null
    }),
    [metadata, dimension, roleOf, nameOf]
  );
}
