"use client";

import FlexIcon from "@/components/icons/FlexIcon";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { useSlotLabel } from "@/hooks/useSlotLabel";
import { roleAccent } from "@/lib/registration/role-accent";
import {
  findRole,
  ratedDimension,
  rolePresentation,
  type RoleOntology,
} from "@/lib/roster/ontology";
import { isRoleSlot, type SlotCode } from "@/lib/roster/shape";
import { cn } from "@/lib/utils";

/** One offerable slot plus how many of it the tournament's roster has. */
export interface RosterSlotOption {
  code: SlotCode;
  count: number;
}

interface RosterSlotPickerProps {
  /** Radio group name — must be unique on the page. */
  name: string;
  options: readonly RosterSlotOption[];
  value: SlotCode | null;
  onChange: (code: SlotCode) => void;
  /** The owner game's scoped ontology: slot names, glyphs and accents are its roles'. */
  ontology: RoleOntology | null;
  disabled?: boolean;
}

/**
 * Pick one roster slot, as role glyphs rather than words.
 *
 * Built on native `<input type="radio">` deliberately: arrow-key navigation,
 * Space activation, one tab stop for the whole group and the correct
 * "radio, 2 of 3" announcement all come free, where the `aria-pressed` button
 * row this replaced had none of them. Radios sharing a `name` already form a
 * group, so the caller supplies the label and description with a `<fieldset>`
 * and `<legend>` rather than this adding `role="radiogroup"` over the platform's
 * own semantics.
 *
 * Labels come from the owner game's ontology (`useSlotLabel`) — the same slot
 * vocabulary the roster shortfall, the invite chips and the admin card use — so
 * one roster never reads two different names for the very same slot.
 *
 * `count` is the slot's multiplicity in the roster, shown only when it is above
 * one: it answers "if I take a damage slot, is there still one left for someone
 * else?" without a second line of copy.
 *
 * `flex` has no role glyph and no hue of its own, so it renders `FlexIcon` in the
 * surrounding text colour — the same mark the roster-shape editor and the role
 * matrix already use for it.
 */
export default function RosterSlotPicker({
  name,
  options,
  value,
  onChange,
  ontology,
  disabled = false,
}: Readonly<RosterSlotPickerProps>) {
  const slotLabel = useSlotLabel(ontology);
  const rated = ontology ? ratedDimension(ontology) : null;

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-2">
      {options.map(({ code, count }) => {
        const selected = value === code;
        const roleRef = rated && isRoleSlot(code) ? { dimension: rated.code, role: code } : null;
        const node = ontology && roleRef ? findRole(ontology, roleRef) : null;
        const accent = roleAccent(
          ontology && node ? rolePresentation(ontology.roles, node.id).color : null,
        );
        return (
          <label
            key={code}
            className={cn(
              "block",
              disabled ? "cursor-not-allowed" : "cursor-pointer active:scale-[0.96]",
              "transition-transform duration-150 ease-out",
            )}
          >
            <input
              type="radio"
              name={name}
              value={code}
              checked={selected}
              disabled={disabled}
              onChange={() => onChange(code)}
              className="peer sr-only"
            />
            <span
              className={cn(
                "flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-lg border px-2 py-3",
                "transition-[background-color,border-color,box-shadow] duration-150 ease-out",
                "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[color:var(--aqt-teal)]",
                disabled && "opacity-50",
                !selected && "border-[color:var(--aqt-border)] hover:bg-[color:var(--aqt-overlay-2)]",
              )}
              style={selected ? accent.selectedCard : undefined}
            >
              {isRoleSlot(code) ? (
                <PlayerRoleIcon role={roleRef} ontology={ontology} size={26} decorative />
              ) : (
                <FlexIcon
                  width={26}
                  height={26}
                  color={selected ? "var(--aqt-fg)" : "var(--aqt-fg-muted)"}
                />
              )}
              <span className="flex items-baseline gap-1 leading-tight">
                <span
                  className={cn(
                    "text-sm font-medium",
                    selected ? "text-[color:var(--aqt-fg)]" : "text-[color:var(--aqt-fg-muted)]",
                  )}
                >
                  {slotLabel(code)}
                </span>
                {count > 1 && (
                  <span className="aqt-tnum text-label tabular-nums text-[color:var(--aqt-fg-dim)]">
                    &times;{count}
                  </span>
                )}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
