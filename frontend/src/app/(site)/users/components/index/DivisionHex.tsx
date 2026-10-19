"use client";

import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { useTranslations } from "next-intl";

import DivisionIcon from "@/components/DivisionIcon";
import { useDivisionGrid } from "@/hooks/useCurrentWorkspace";
import { useRoleName } from "@/hooks/useRoleName";
import { getDivisionLabel } from "@/lib/divisions/grid";
import { findRole, type RoleOntology } from "@/lib/roster/ontology";
import type { RoleRef } from "@/lib/roster/role-ref";
import type { DivisionGridVersion } from "@/types/workspace.types";

/**
 * A player's division crest for one role, titled with the tier name from the
 * grid the number actually belongs to — `roleGrid` in all-workspaces mode
 * (each row's own tournament grid), the workspace's grid of the game otherwise.
 */
export const DivisionHex = ({
  role,
  division,
  roleGrid,
  discipline,
  ontology,
  size = 30
}: Readonly<{
  /** `null`: no rated assignment (the open slot). */
  role: RoleRef | null;
  division: number;
  roleGrid?: DivisionGridVersion | null;
  /** The index's game: its workspace grid and crests (`null` only before it resolves; no row exists then). */
  discipline: string | null;
  /** Its role dictionary; `null` while it loads (the role then reads by code). */
  ontology: RoleOntology | null;
  size?: number;
}>) => {
  const t = useTranslations();
  const nameOf = useRoleName();
  const workspaceGrid = useDivisionGrid(discipline ?? undefined);
  const node = ontology ? findRole(ontology, role) : null;
  const roleName = role === null ? t("common.roles.flex") : node ? nameOf(node) : role.role;
  const title = t("users.list.division.badgeTitle", {
    role: roleName,
    tier:
      getDivisionLabel(roleGrid ?? workspaceGrid, division) ??
      t("common.divisionWithId", { id: String(division) })
  });

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center rounded-full border border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-overlay-3)] p-0.5"
      title={title}
      style={{ width: size + 2, height: size + 2 }}
    >
      <DivisionIcon
        division={division}
        tournamentGrid={roleGrid}
        discipline={discipline ?? undefined}
        width={size}
        height={size}
        className="h-full w-full"
      />
      <span className="absolute -bottom-1 -right-1 flex size-4 items-center justify-center overflow-hidden rounded-full border-2 border-[color:var(--aqt-card)] bg-[color:var(--aqt-card-2)] p-px">
        <PlayerRoleIcon role={role} ontology={ontology} size={12} label={t("users.list.a11y.roleAlt", { role: roleName })} />
      </span>
    </span>
  );
};
