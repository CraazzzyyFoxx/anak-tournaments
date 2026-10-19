"use client";

import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { useSlotLabel } from "@/hooks/useSlotLabel";
import { cn } from "@/lib/utils";
import type { CustomGamePlayer, CustomGamePlayerPatch } from "@/services/custom-game.service";

import { roleRefsOf, resolveRoleOrder, toggleRole, type MixOwner } from "../pickup-lineup";

/**
 * The roles a player can be seated in, in the order the host set them.
 *
 * Three facts in one rail, none of them a number: **which** roles the
 * balancer may use (a lit glyph vs a dimmed one), **which one comes first**
 * (leftmost position, "first choice" in the name), and **which selection
 * will fail** (the amber ring — a role switched on with no rank behind it,
 * which rejects the whole run server-side).
 *
 * The order is the balancer's stored priority (see `resolveRoleOrder`), so a
 * click here only ever turns a role on or off — reordering belongs to the
 * player sheet, which has room for a drag list. The roles are the mix owner's
 * game's own, so the rail is as wide as that game's role count.
 */
export function RolePriorityRail({
  row,
  label,
  owner,
  canWrite,
  saving,
  onPatch
}: Readonly<{
  row: CustomGamePlayer;
  label: string;
  owner: MixOwner;
  canWrite: boolean;
  saving: boolean;
  onPatch: (patch: CustomGamePlayerPatch) => void;
}>) {
  const slotLabel = useSlotLabel(owner.ontology);
  const order = resolveRoleOrder(row, owner.roles);
  // Off roles trail the selected ones in the game's declared order: an unselected role
  // has no priority, so placing them at all would imply one.
  const off = owner.roles.filter((role) => !order.includes(role));
  const dimension = owner.dimension;

  return (
    <div
      role="group"
      aria-label={`Roles for ${label}`}
      className="flex shrink-0 items-center justify-end gap-1.5"
    >
      {[...order, ...off].map((role) => {
        const position = order.indexOf(role);
        const isOn = position !== -1;
        const isPrimary = position === 0;
        const roleRank = row.ranks[role];
        const name = slotLabel(role);
        return (
          <IconTooltip
            key={role}
            control
            className="shrink-0"
            label={roleRank == null ? `${name}: no rank` : `${name}: ${roleRank} pts`}
            hint={isOn ? (isPrimary ? "First choice" : "Also plays") : "Off"}
          >
            <button
              type="button"
              disabled={!canWrite || saving || dimension == null}
              aria-pressed={isOn}
              aria-label={`${name} for ${label}, ${
                isOn ? (isPrimary ? "first choice" : "also plays") : "off"
              }${roleRank == null ? ", no rank" : `, ${roleRank} points`}`}
              onClick={() => {
                if (dimension != null) onPatch({ roles: roleRefsOf(toggleRole(order, role), dimension) });
              }}
              className={cn(
                "relative flex size-[30px] items-center justify-center rounded-lg transition-opacity",
                isOn ? "opacity-100" : "opacity-30",
                isOn && roleRank == null && "ring-1 ring-amber-400/70",
                "disabled:cursor-default"
              )}
            >
              <PlayerRoleIcon role={role} ontology={owner.ontology} size={19} decorative />
            </button>
          </IconTooltip>
        );
      })}
    </div>
  );
}
