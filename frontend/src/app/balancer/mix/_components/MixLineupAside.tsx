import { X } from "lucide-react";

import { EYEBROW_CLASS } from "@/app/balancer/mix/pickup-chrome";
import { splitHandle } from "@/components/balancer/balancer-page-helpers";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { useSlotLabel } from "@/hooks/useSlotLabel";
import { cn } from "@/lib/utils";
import type { CustomGamePlayer } from "@/services/custom-game.service";

import {
  averageRank,
  playerLabel,
  resolveRoleOrder,
  sortLineup,
  summarizeLineup,
  summarizeRoleSupply,
  type MixOwner
} from "../pickup-lineup";

/**
 * The lineup, as the right half of the picker: seat count against a full
 * lobby, role supply against demand, and who is already in.
 *
 * It lives beside the roster rather than behind it so every click on the left
 * answers "have I got a lobby" without closing the dialog -- the whole reason
 * the picker stopped being a single-column overlay.
 *
 * A full lobby and each role's demand come from the mix's own roster shape
 * (`MixOwner`), so the same panel reads 5v5 League and 5v5 Overwatch correctly.
 */
export function MixLineupAside({
  rows,
  owner,
  canWrite,
  onTogglePlayer,
  onDone
}: Readonly<{
  rows: CustomGamePlayer[];
  owner: MixOwner;
  canWrite: boolean;
  onTogglePlayer: (memberId: number) => void;
  onDone: () => void;
}>) {
  const slotLabel = useSlotLabel(owner.ontology);
  const summary = summarizeLineup(rows, owner.roles);
  const supply = summarizeRoleSupply(rows, owner);
  const { lobbySize } = owner;
  const overflow = lobbySize == null ? 0 : summary.active - lobbySize;

  return (
    <aside className="flex min-h-0 flex-col border-t border-[color:var(--aqt-border)] bg-[color:var(--aqt-bg-2)] lg:border-l lg:border-t-0">
      <div className="flex shrink-0 items-baseline gap-2 px-4 pb-2.5 pt-3.5">
        <h3 className={EYEBROW_CLASS}>In this mix</h3>
        <span className="ml-auto flex items-baseline gap-1 tabular-nums">
          <span
            className={cn(
              "text-xl font-bold leading-none",
              overflow > 0
                ? "text-[color:var(--aqt-amber)]"
                : lobbySize != null && summary.active === lobbySize
                  ? "text-[color:var(--aqt-teal)]"
                  : "text-[color:var(--aqt-fg)]"
            )}
          >
            {summary.active}
          </span>
          {lobbySize == null ? null : (
            <span className="text-caption text-[color:var(--aqt-fg-faint)]">{`/ ${lobbySize}`}</span>
          )}
        </span>
      </div>

      {/* The instrument panel. Supply against demand per role, counted the
          way the solver counts it, so "short one tank" is visible before
          Balance runs rather than inferred from a seated lineup after. */}
      {supply.length === 0 ? null : (
        <div className="grid shrink-0 grid-cols-[repeat(auto-fit,minmax(4.5rem,1fr))] gap-1.5 px-4 pb-3">
          {supply.map((entry) => {
            const short = entry.short > 0;
            const name = slotLabel(entry.role);
            return (
              <div
                key={entry.role}
                className="rounded-lg border border-[color:var(--aqt-border)] bg-[color:var(--aqt-bg-2)] px-2 pb-1.5 pt-1.5"
              >
                <div className="flex items-center gap-1">
                  <IconTooltip
                    label={
                      short
                        ? `${name}: ${entry.supply} of ${entry.need} — short ${entry.short}`
                        : `${name}: ${entry.supply} of ${entry.need}`
                    }
                  >
                    <PlayerRoleIcon role={entry.role} ontology={owner.ontology} size={13} decorative />
                  </IconTooltip>
                  <span
                    className={cn(
                      "ml-auto text-label font-semibold tabular-nums",
                      short ? "text-[color:var(--aqt-amber)]" : "text-[color:var(--aqt-emerald)]"
                    )}
                  >
                    {`${entry.supply}/${entry.need}`}
                  </span>
                </div>
                <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-[color:var(--aqt-overlay-3)]">
                  <div
                    className={cn(
                      "h-full rounded-full transition-[width] duration-200",
                      short ? "bg-[color:var(--aqt-amber)]" : "bg-[color:var(--aqt-emerald)]"
                    )}
                    style={{
                      width: `${Math.min(100, Math.round((entry.supply / entry.need) * 100))}%`
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-[color:var(--aqt-border)] px-2 py-1.5">
        {rows.length === 0 ? (
          <p className="px-2 py-8 text-center text-caption text-[color:var(--aqt-fg-dim)]">
            Nobody yet. Pick from the left, or press Enter on the highlighted row.
          </p>
        ) : (
          <ul className="space-y-0.5" aria-label="Players in this mix">
            {sortLineup(rows).map((row) => (
              <LineupChip
                key={row.workspace_member_id}
                row={row}
                owner={owner}
                canWrite={canWrite}
                onRemove={() => onTogglePlayer(row.workspace_member_id)}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="flex h-14 shrink-0 items-center gap-3 border-t border-[color:var(--aqt-border)] px-4">
        <p className="min-w-0 flex-1 text-label leading-tight text-[color:var(--aqt-fg-dim)]">
          {lobbySize == null
            ? ""
            : overflow > 0
              ? `${overflow} over a full lobby \u2014 bench the rest in the lineup.`
              : overflow === 0
                ? "A full lobby. Balance is ready to run."
                : `${-overflow} more for a full lobby.`}
        </p>
        <Button type="button" className="shrink-0" onClick={onDone}>
          Done
        </Button>
      </div>
    </aside>
  );
}

/**
 * One seated player, as the right column shows them: who, what they can play in
 * what order, what they are worth, and the way out.
 *
 * The role glyphs carry no numbers and no controls. Priority here is the
 * host-set order (`resolveRoleOrder`) so this list and the lineup panel behind
 * the dialog cannot disagree about what a player plays first, and editing
 * belongs to the lineup sheet, which has the room for it.
 */
function LineupChip({
  row,
  owner,
  canWrite,
  onRemove
}: Readonly<{ row: CustomGamePlayer; owner: MixOwner; canWrite: boolean; onRemove: () => void }>) {
  const slotLabel = useSlotLabel(owner.ontology);
  const label = playerLabel(row);
  const { name, suffix } = splitHandle(label);
  const order = resolveRoleOrder(row, owner.roles);
  const rank = averageRank(row, owner.roles);

  return (
    <li
      className={cn(
        "group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-[color:var(--aqt-overlay-2)]",
        row.participation === "benched" && "opacity-55"
      )}
    >
      <span className="flex min-w-0 flex-1 items-baseline gap-1">
        <span
          className="truncate text-caption font-semibold text-[color:var(--aqt-fg)]"
          title={label}
        >
          {name}
        </span>
        {suffix ? (
          <span className="shrink-0 text-label text-[color:var(--aqt-fg-faint)]">{suffix}</span>
        ) : null}
      </span>

      {owner.showsRoles ? (
        <span aria-hidden="true" className="flex shrink-0 items-center gap-0.5">
          {owner.roles.map((role) => {
            const position = order.indexOf(role);
            const isOn = position !== -1;
            return (
              <IconTooltip
                key={role}
                label={`${slotLabel(role)}: ${
                  isOn ? (position === 0 ? "first choice" : "also plays") : "off"
                }`}
                className={cn("size-5 items-center justify-center rounded", !isOn && "opacity-20")}
              >
                <PlayerRoleIcon role={role} ontology={owner.ontology} size={13} decorative />
              </IconTooltip>
            );
          })}
        </span>
      ) : null}

      <span className="w-11 shrink-0 text-right text-caption font-semibold tabular-nums text-[color:var(--aqt-fg-muted)]">
        {rank ?? "\u2014"}
      </span>

      {canWrite ? (
        <IconTooltip control label="Remove from this mix" className="shrink-0">
          <button
            type="button"
            onClick={onRemove}
            className="flex size-5 items-center justify-center rounded text-[color:var(--aqt-fg-faint)] opacity-0 transition-opacity hover:text-[color:var(--aqt-rose)] focus-visible:opacity-100 group-hover:opacity-100"
          >
            <X className="size-3.5" aria-hidden="true" />
            <span className="sr-only">{`Remove ${label} from this mix`}</span>
          </button>
        </IconTooltip>
      ) : (
        <span aria-hidden="true" className="size-5 shrink-0" />
      )}
    </li>
  );
}
