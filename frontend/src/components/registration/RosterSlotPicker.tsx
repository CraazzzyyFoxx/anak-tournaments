"use client";

import FlexIcon from "@/components/icons/FlexIcon";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
  /** Id of the visible element naming the group. */
  "aria-labelledby": string;
  "aria-describedby"?: string;
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
 * A Radix radio group, so arrow-key navigation (moving and selecting), one tab
 * stop for the whole group and the "radio, 2 of 3" announcement all come with
 * it, where the `aria-pressed` button row this replaced had none of them. The
 * caller names the group with a visible label (`aria-labelledby`) and may
 * describe it (`aria-describedby`); each card is the radio itself, named by its
 * slot label.
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
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
  options,
  value,
  onChange,
  ontology,
  disabled = false,
}: Readonly<RosterSlotPickerProps>) {
  const slotLabel = useSlotLabel(ontology);
  const rated = ontology ? ratedDimension(ontology) : null;

  return (
    <RadioGroup
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      value={value ?? ""}
      onValueChange={onChange}
      disabled={disabled}
      className="grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-2"
    >
      {options.map(({ code, count }) => {
        const selected = value === code;
        const roleRef = rated && isRoleSlot(code) ? { dimension: rated.code, role: code } : null;
        const node = ontology && roleRef ? findRole(ontology, roleRef) : null;
        const accent = roleAccent(
          ontology && node ? rolePresentation(ontology.roles, node.id).color : null,
        );
        return (
          <RadioGroupItem
            key={code}
            value={code}
            variant="card"
            className="flex min-h-20 flex-col items-center justify-center gap-1.5 px-2 py-3"
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
                  "font-medium",
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
          </RadioGroupItem>
        );
      })}
    </RadioGroup>
  );
}
