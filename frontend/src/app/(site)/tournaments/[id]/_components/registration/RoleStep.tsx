"use client";

import { type ReactNode } from "react";
import { Check } from "lucide-react";

import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import FlexIcon from "@/components/icons/FlexIcon";
import { cn } from "@/lib/utils";
import type { RegistrationForm } from "@/types/registration.types";

import { ROLES } from "./constants";
import type { AdditionalRole } from "./types";
import { getSubroleOptions } from "./utils";

interface RoleStepProps {
  isFlex: boolean;
  primaryRole: string;
  subrole: string;
  additionalRoles: AdditionalRole[];
  onSetFlex: (isFlex: boolean) => void;
  onSetPrimaryRole: (role: string) => void;
  onSetSubrole: (subrole: string) => void;
  onSetAdditionalRoles: (roles: AdditionalRole[]) => void;
  primaryRoleError?: string | null;
  secondaryRolesError?: string | null;
  form: RegistrationForm;
  hideHelperText?: boolean;
}

const ROLE_ACCENTS: Record<
  string,
  {
    tile: string;
    selectedCard: string;
    indicator: string;
    mutedIndicator: string;
  }
> = {
  tank: {
    tile: "bg-sky-500/18 text-sky-200",
    selectedCard: "border-sky-400/75 bg-sky-500/10 shadow-[0_0_0_1px_rgba(56,189,248,0.14)]",
    indicator: "border-sky-300",
    mutedIndicator: "border-sky-300/45",
  },
  dps: {
    tile: "bg-orange-500/18 text-orange-200",
    selectedCard: "border-orange-400/75 bg-orange-500/10 shadow-[0_0_0_1px_rgba(251,146,60,0.14)]",
    indicator: "border-orange-300",
    mutedIndicator: "border-orange-300/45",
  },
  support: {
    tile: "bg-emerald-500/18 text-emerald-200",
    selectedCard: "border-emerald-400/75 bg-emerald-500/10 shadow-[0_0_0_1px_rgba(52,211,153,0.14)]",
    indicator: "border-emerald-300",
    mutedIndicator: "border-emerald-300/45",
  },
  flex: {
    tile: "bg-violet-500/18 text-violet-200",
    selectedCard: "border-violet-400/75 bg-violet-500/10 shadow-[0_0_0_1px_rgba(167,139,250,0.14)]",
    indicator: "border-violet-300",
    mutedIndicator: "border-violet-300/45",
  },
};

const MAIN_ROLE_LAYOUT_ORDER = ["flex", "tank", "dps", "support"] as const;

export default function RoleStep({
  isFlex,
  primaryRole,
  subrole,
  additionalRoles,
  onSetFlex,
  onSetPrimaryRole,
  onSetSubrole,
  onSetAdditionalRoles,
  primaryRoleError = null,
  secondaryRolesError = null,
  form,
  hideHelperText = false,
}: RoleStepProps) {
  const isAdditionalRolesRequired =
    form.built_in_fields?.additional_roles?.enabled !== false
    && form.built_in_fields?.additional_roles?.required === true;
  const canEditSecondaryRoles = !!primaryRole && !isFlex;
  const selectableSecondaryRoles = primaryRole ? ROLES.filter((role) => role.code !== primaryRole) : [];
  const areAllAdditionalSelected =
    canEditSecondaryRoles
    && selectableSecondaryRoles.length > 0
    && selectableSecondaryRoles.every((role) => additionalRoles.some((entry) => entry.code === role.code));
  const secondaryRolesDescription = !primaryRole
    ? "Pick a primary role first to reveal your fallback role options."
    : isFlex
      ? "Flex already covers all roles, so no fallback roles are needed."
      : "These are fallback roles. If a team is missing one of them, we may place you there during balancing.";

  const handlePrimaryRoleSelect = (roleCode: string) => {
    if (isFlex || primaryRole !== roleCode) {
      onSetFlex(false);
      onSetPrimaryRole(roleCode);
      onSetSubrole("");
      onSetAdditionalRoles(additionalRoles.filter((entry) => entry.code !== roleCode));
    }
  };

  const handleFlexSelect = () => {
    if (!isFlex) {
      onSetFlex(true);
    }
  };

  const toggleAdditionalRole = (roleCode: string) => {
    if (!canEditSecondaryRoles || roleCode === primaryRole) {
      return;
    }

    const exists = additionalRoles.some((entry) => entry.code === roleCode);

    if (exists) {
      onSetAdditionalRoles(additionalRoles.filter((entry) => entry.code !== roleCode));
      return;
    }

    onSetAdditionalRoles([...additionalRoles, { code: roleCode, subrole: "" }]);
  };

  const setAdditionalSubrole = (roleCode: string, nextSubrole: string) => {
    if (!canEditSecondaryRoles || roleCode === primaryRole) {
      return;
    }

    const exists = additionalRoles.some((entry) => entry.code === roleCode);
    if (!exists) {
      onSetAdditionalRoles([...additionalRoles, { code: roleCode, subrole: nextSubrole }]);
      return;
    }

    onSetAdditionalRoles(
      additionalRoles.map((entry) =>
        entry.code === roleCode ? { ...entry, subrole: nextSubrole } : entry,
      ),
    );
  };

  const handleSelectAllAdditionalRoles = () => {
    if (!canEditSecondaryRoles) {
      return;
    }

    if (areAllAdditionalSelected) {
      onSetAdditionalRoles([]);
      return;
    }

    onSetAdditionalRoles(
      selectableSecondaryRoles.map((role) => {
        const existing = additionalRoles.find((entry) => entry.code === role.code);
        return existing ?? { code: role.code, subrole: "" };
      }),
    );
  };

  return (
    <div className="grid gap-5">
      {!hideHelperText ? (
        <div className="space-y-1">
          <h3 className="text-xs font-medium text-white/85">Choose Your Role</h3>
          <p className="max-w-[40rem] text-xs leading-5 text-white/42">
            Set your primary role first. Then choose secondary roles we can assign you to if a
            team is short on them during balancing.
          </p>
        </div>
      ) : null}

      <section className="space-y-2.5">
        <div className="space-y-0.5">
          <h4 className="text-xs font-medium uppercase tracking-[0.14em] text-white/55">Primary Role</h4>
          {!hideHelperText ? (
            <p className="text-xs leading-5 text-white/42">
              This is the role we should place you on by default.
            </p>
          ) : null}
        </div>

        {primaryRoleError && (
          <div className="rounded-lg border border-amber-400/20 bg-amber-500/[0.06] px-3 py-2 text-xs leading-5 text-amber-100/90">
            {primaryRoleError}
          </div>
        )}

        <div className="grid items-start gap-2 md:grid-cols-2">
          {MAIN_ROLE_LAYOUT_ORDER.map((roleCode) => {
            if (roleCode === "flex") {
              return (
                <SelectionCard
                  key="flex"
                  roleCode="flex"
                  label="Flex"
                  selected={isFlex}
                  reserveHintSpace
                  type="radio"
                  onClick={handleFlexSelect}
                  hint={isFlex ? "All roles, equal priority" : undefined}
                  icon={<FlexIcon width={16} height={16} />}
                />
              );
            }

            const role = ROLES.find((entry) => entry.code === roleCode);
            if (!role) {
              return null;
            }

            const selected = !isFlex && primaryRole === role.code;
            const subroles = getSubroleOptions(role.code, form);

            return (
              <SelectionCard
                key={role.code}
                roleCode={role.code}
                label={role.display}
                selected={selected}
                detailsSelectsCard={!selected}
                reserveHintSpace
                type="radio"
                onClick={() => handlePrimaryRoleSelect(role.code)}
              >
                {subroles.length > 0 && (
                  <SpecializationBlock
                    label="Specialization"
                    value={subrole}
                    options={subroles}
                    disabled={!selected}
                    onDisabledSelect={(nextValue) => {
                      handlePrimaryRoleSelect(role.code);
                      onSetSubrole(nextValue);
                    }}
                    onChange={(nextValue) => onSetSubrole(nextValue)}
                  />
                )}
              </SelectionCard>
            );
          })}
        </div>
      </section>

      <section className="space-y-2.5">
        <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-medium uppercase tracking-[0.14em] text-white/55">
                  Secondary Roles
                </h4>
                <span
                  className={cn(
                    "rounded-full border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide",
                    isAdditionalRolesRequired
                      ? "border-amber-400/20 bg-amber-500/[0.08] text-amber-200/90"
                      : "border-white/10 text-white/40",
                  )}
                >
                  {isAdditionalRolesRequired ? "Required" : "Optional"}
                </span>
              </div>
              {!hideHelperText ? (
                <p className="max-w-[40rem] text-xs leading-5 text-white/42">
                  {secondaryRolesDescription}
                </p>
              ) : null}
            </div>

          <button
            type="button"
            disabled={!canEditSecondaryRoles}
            onClick={handleSelectAllAdditionalRoles}
            className={cn(
              "shrink-0 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors",
              !canEditSecondaryRoles && "cursor-default border-white/10 bg-white/[0.02] text-white/30",
              canEditSecondaryRoles
                && (areAllAdditionalSelected
                  ? "border-violet-400/50 bg-violet-500/12 text-violet-200"
                  : "border-white/10 bg-white/[0.03] text-white/55 hover:bg-white/[0.06] hover:text-white/75"),
            )}
          >
            {areAllAdditionalSelected ? "Clear all" : "Select all"}
          </button>
        </div>

        {secondaryRolesError && (
          <div className="rounded-lg border border-amber-400/20 bg-amber-500/[0.06] px-3 py-2 text-xs leading-5 text-amber-100/90">
            {secondaryRolesError}
          </div>
        )}

        {canEditSecondaryRoles ? (
          <div className="grid items-start gap-2 sm:grid-cols-2">
            {selectableSecondaryRoles.map((role) => {
              const selected = additionalRoles.some((entry) => entry.code === role.code);
              const entry = additionalRoles.find((additionalRole) => additionalRole.code === role.code);
              const subroles = getSubroleOptions(role.code, form, "additional_roles");

              return (
                <SelectionCard
                  key={role.code}
                  roleCode={role.code}
                  label={role.display}
                  selected={selected}
                  detailsSelectsCard={!selected}
                  reserveDetailsSpace={subroles.length === 0}
                  type="checkbox"
                  compact
                  onClick={() => toggleAdditionalRole(role.code)}
                >
                  {subroles.length > 0 && (
                    <SpecializationBlock
                      label={`${role.display} specialization`}
                      value={selected ? entry?.subrole ?? "" : ""}
                      options={subroles}
                      disabled={!selected}
                      onDisabledSelect={(nextValue) => setAdditionalSubrole(role.code, nextValue)}
                      onChange={(nextValue) => setAdditionalSubrole(role.code, nextValue)}
                    />
                  )}
                </SelectionCard>
              );
            })}
          </div>
        ) : (
          <SecondaryRolesEmptyState isFlex={isFlex} />
        )}
      </section>
    </div>
  );
}

interface SelectionCardProps {
  roleCode: string;
  label: string;
  selected: boolean;
  disabled?: boolean;
  detailsSelectsCard?: boolean;
  reserveHintSpace?: boolean;
  reserveDetailsSpace?: boolean;
  type: "radio" | "checkbox";
  onClick: () => void;
  children?: ReactNode;
  hint?: string;
  compact?: boolean;
  icon?: ReactNode;
}

function SelectionCard({
  roleCode,
  label,
  selected,
  disabled = false,
  detailsSelectsCard = false,
  reserveHintSpace = false,
  reserveDetailsSpace = false,
  type,
  onClick,
  children,
  hint,
  compact = false,
  icon,
}: SelectionCardProps) {
  const visuals = ROLE_ACCENTS[roleCode];
  const hasDetails = Boolean(children);
  const shouldRenderDetailsSlot = hasDetails || reserveDetailsSpace;
  const detailsAreaInteractive = hasDetails ? detailsSelectsCard : reserveDetailsSpace;

  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border bg-white/[0.02] transition-all",
        selected
          ? visuals.selectedCard
          : disabled
            ? "border-white/10 bg-white/[0.015] opacity-55"
          : "border-white/10 hover:border-white/15 hover:bg-white/[0.04]",
      )}
    >
      <button
        type="button"
        disabled={disabled}
        aria-disabled={disabled}
        onClick={onClick}
        className={cn(
          "flex w-full justify-between gap-3",
          hasDetails || reserveDetailsSpace ? "items-center" : "items-start",
          compact ? "px-2.5 py-[7px]" : "px-2.5 py-2",
          disabled && "cursor-default",
        )}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <RoleIconTile
            roleCode={roleCode}
            compact={compact}
            icon={icon ?? <PlayerRoleIcon role={getRoleIconName(roleCode)} size={18} />}
          />
          <div className="min-w-0 text-left">
            <p className={cn("text-[12px] font-semibold", disabled ? "text-white/65" : "text-white")}>
              {label}
            </p>
            {hint && (
              <p className={cn("text-xs leading-5", disabled ? "text-white/35" : "text-white/45")}>
                {hint}
              </p>
            )}
            {!hint && reserveHintSpace && <div aria-hidden="true" className="h-5" />}
          </div>
        </div>

        {type === "radio" ? (
          <SelectionIndicator
            selected={selected}
            selectedBorderClass={visuals.indicator}
            idleBorderClass={visuals.mutedIndicator}
          />
        ) : (
          <CheckboxIndicator
            selected={selected}
            selectedBorderClass={visuals.indicator}
            idleBorderClass={visuals.mutedIndicator}
          />
        )}
      </button>

      {shouldRenderDetailsSlot && (
        <div
          className={cn(
            "border-t border-white/10 px-2.5 pb-2.5 pt-1.5",
            detailsAreaInteractive && "cursor-pointer",
          )}
          onClick={detailsAreaInteractive ? onClick : undefined}
          onKeyDown={
            detailsAreaInteractive
              ? (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onClick();
                  }
                }
              : undefined
          }
          role={detailsAreaInteractive ? "button" : undefined}
          tabIndex={detailsAreaInteractive ? 0 : undefined}
        >
          {hasDetails ? children : <div aria-hidden="true" className="min-h-[42px]" />}
        </div>
      )}
    </div>
  );
}

function SecondaryRolesEmptyState({ isFlex }: { isFlex: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.015] px-3 py-3 text-sm text-white/42">
      {isFlex
        ? "Flex already covers every role, so fallback roles are not needed for this registration."
        : "Choose a primary role first. We will then show the two fallback roles you can also be assigned to."}
    </div>
  );
}

function RoleIconTile({
  roleCode,
  icon,
  compact = false,
}: {
  roleCode: string;
  icon: ReactNode;
  compact?: boolean;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl",
        compact ? "size-7" : "size-8",
        ROLE_ACCENTS[roleCode].tile,
      )}
    >
      {icon}
    </span>
  );
}

function SelectionIndicator({
  selected,
  selectedBorderClass,
  idleBorderClass,
}: {
  selected: boolean;
  selectedBorderClass: string;
  idleBorderClass: string;
}) {
  return (
    <span
      className={cn(
        "flex size-4 shrink-0 self-center items-center justify-center rounded-full border transition-colors",
        selected ? selectedBorderClass : idleBorderClass,
      )}
    >
      {selected && <span className="size-1 rounded-full bg-current" />}
    </span>
  );
}

function CheckboxIndicator({
  selected,
  selectedBorderClass,
  idleBorderClass,
}: {
  selected: boolean;
  selectedBorderClass: string;
  idleBorderClass: string;
}) {
  return (
    <span
      className={cn(
        "flex size-4 shrink-0 self-center items-center justify-center rounded-[5px] border transition-colors",
        selected ? selectedBorderClass : idleBorderClass,
      )}
    >
      {selected && <Check className="size-2.5 text-current" strokeWidth={2.8} />}
    </span>
  );
}

function SpecializationBlock({
  label,
  value,
  options,
  onChange,
  disabled = false,
  onDisabledSelect,
  hideLabel = false,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (nextValue: string) => void;
  disabled?: boolean;
  onDisabledSelect?: (nextValue: string) => void;
  hideLabel?: boolean;
}) {
  const handleSelect = (nextValue: string) => {
    if (disabled) {
      onDisabledSelect?.(nextValue);
      return;
    }

    onChange(nextValue);
  };

  return (
    <div className="space-y-1.5">
      {!hideLabel && (
        <p
          className={cn(
            "text-[11px] font-medium uppercase tracking-[0.12em]",
            disabled ? "text-white/28" : "text-white/42",
          )}
        >
          {label}
        </p>
      )}
      <div className="flex flex-nowrap gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <SubrolePill
          label="Any"
          active={value === ""}
          muted={disabled}
          disabled={disabled && !onDisabledSelect}
          onClick={() => handleSelect("")}
        />
        {options.map((option) => (
          <SubrolePill
            key={option.value}
            label={option.label}
            active={value === option.value}
            muted={disabled}
            disabled={disabled && !onDisabledSelect}
            onClick={() => handleSelect(option.value)}
          />
        ))}
      </div>
    </div>
  );
}

function SubrolePill({
  label,
  active,
  muted = false,
  disabled = false,
  onClick,
}: {
  label: string;
  active: boolean;
  muted?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      aria-disabled={disabled || muted}
      className={cn(
        "shrink-0 whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-medium leading-4 transition-colors",
        disabled && "cursor-default opacity-45",
        muted && !disabled && "opacity-45",
        !disabled && active
          ? "border-blue-400/60 bg-blue-500/18 text-blue-100"
          : "border-white/10 bg-white/[0.03] text-white/55",
        !disabled && !active && "hover:bg-white/[0.06] hover:text-white/75",
      )}
    >
      {label}
    </button>
  );
}

function getRoleIconName(roleCode: string): string {
  if (roleCode === "tank") {
    return "Tank";
  }
  if (roleCode === "dps") {
    return "Damage";
  }
  if (roleCode === "support") {
    return "Support";
  }
  return "Support";
}
