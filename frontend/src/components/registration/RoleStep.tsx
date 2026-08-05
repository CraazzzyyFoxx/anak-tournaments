"use client";

import { useTranslations } from "next-intl";

import FlexIcon from "@/components/icons/FlexIcon";
import { cn } from "@/lib/utils";
import {
  REGISTRATION_TO_CANONICAL,
  ROLES,
  ROLE_ACCENTS,
  getSubroleOptions,
  type RoleCode,
} from "@/lib/roles";
import type { Hero } from "@/types/hero.types";
import type { RegistrationForm } from "@/types/registration.types";

import {
  isFlexSelection,
  priorityChoice,
  type FlexMode,
  type RolePriority,
  type RoleSelections,
} from "./types";
import { RoleMatrixRow } from "./role-step/RoleMatrixRow";
import { SegmentedRadio, type SegmentedOption } from "./role-step/SegmentedRadio";

interface RoleStepProps {
  selections: RoleSelections;
  onChange: (next: RoleSelections) => void;
  /** Step-level role error, shown once above the matrix. */
  error?: string | null;
  form: RegistrationForm;
  hideHelperText?: boolean;
  allHeroes: Hero[];
  topHeroesEnabled: boolean;
  maxHeroes: number;
  /**
   * `off` — flex banned by the form. `optional` — the preset is offered.
   * `all_roles` — every role mandatory; one radiogroup asks for a single
   * priority role or flex, and the per-row priority disappears.
   * `forced` — role does not matter at all: no choice, every role permanently
   * main.
   */
  flexMode: FlexMode;
}

/**
 * Role step, laid out as a fixed matrix: one row per role, always showing the
 * same four cells (role, priority, specialization, top heroes).
 *
 * It used to be three stacked sections — primary roles, secondary roles, top
 * heroes — where the last two only appeared once a primary role was chosen and
 * the hero section grew one full roster grid per selected role. Selecting a role
 * took the step from 17 to 69 focusable controls. Here the selection only
 * changes control *state*, never the set of rendered controls.
 */
export default function RoleStep({
  selections,
  onChange,
  error = null,
  form,
  hideHelperText = false,
  allHeroes,
  topHeroesEnabled,
  maxHeroes,
  flexMode,
}: RoleStepProps) {
  const t = useTranslations();
  const isForced = flexMode === "forced";
  const isAllRoles = flexMode === "all_roles";
  const showPriority = !isForced && !isAllRoles;
  const isFlex = isForced || isFlexSelection(selections);
  const isAdditionalRolesRequired =
    form.built_in_fields?.additional_roles?.enabled !== false &&
    form.built_in_fields?.additional_roles?.required === true;

  /**
   * The roster offered for one row, always filtered to that row's role.
   *
   * Flex used to widen this to the full roster, which made sense while flex
   * rendered a *single* hero block (pre-matrix `RoleStep`): the picker was not
   * attached to a role. Here every row IS a role and its picks are submitted
   * under that role's `top_heroes`, so the full roster would offer Ana as a tank
   * pick — and the backend only tolerates that while the submission stays flex
   * (`_validate_role_heroes`), rejecting it the moment it does not.
   *
   * Already-selected slugs stay in the roster whatever their class: an existing
   * flex registration may carry a cross-class pick, and a tile that is not
   * offered cannot be deselected — the registrant would be stuck with a hero the
   * backend rejects as soon as they stop being flex.
   */
  const heroesForRole = (roleCode: string): Hero[] => {
    const canonical = REGISTRATION_TO_CANONICAL[roleCode as RoleCode];
    if (!canonical) {
      return allHeroes;
    }
    const selected = selections[roleCode as RoleCode].topHeroes;
    return allHeroes.filter(
      (hero) =>
        (hero.role || hero.type || "").toLowerCase() === canonical || selected.includes(hero.slug),
    );
  };

  const subroleOptionsFor = (roleCode: string, priority: RolePriority) =>
    getSubroleOptions(form, roleCode, priority === "main" ? "primary_role" : "additional_roles");

  /**
   * Exactly one role may be `main`, unless every role is (which is how the
   * backend derives a flex registration). Anything in between is normalized by
   * demoting the mains the registrant did not just touch.
   *
   * All three mains survive in every mode that permits flex, not just
   * `optional`: `all_roles` expresses flex the same way, and since
   * `setSubrole`/`setHeroes` route through here, trimming it would turn picking
   * a specialization into "that role is now my main".
   *
   * In the forced mode three mains ARE the target state, so this is the
   * identity. Combined with the absent priority control that makes `off`
   * unreachable: `setSubrole`/`setHeroes` only ever promote.
   */
  const normalize = (next: RoleSelections, changed: RoleCode): RoleSelections => {
    if (isForced) {
      return next;
    }
    const mains = ROLES.filter((role) => next[role.code].priority === "main");
    if (mains.length <= 1 || (mains.length === ROLES.length && flexMode !== "off")) {
      return next;
    }
    // A promotion names its own winner. A demotion does not: crowning a survivor
    // hands the registrant a main role they never picked, so leaving flex leaves
    // the step with no main at all and the validation asks for one.
    const keep: RoleCode | null = next[changed].priority === "main" ? changed : null;
    for (const role of mains) {
      if (role.code !== keep) {
        next[role.code] = { ...next[role.code], priority: "fallback" };
      }
    }
    return next;
  };

  const setPriority = (roleCode: RoleCode, priority: RolePriority) => {
    const next: RoleSelections = { ...selections, [roleCode]: { ...selections[roleCode], priority } };
    // The allowed specializations differ between a main and a fallback role
    // (the backend keys the allowlist on `is_primary`), so drop a value the new
    // priority no longer offers instead of submitting something invalid.
    const allowed = subroleOptionsFor(roleCode, priority).map((option) => option.slug);
    if (next[roleCode].subrole && !allowed.includes(next[roleCode].subrole)) {
      next[roleCode] = { ...next[roleCode], subrole: "" };
    }
    onChange(normalize(next, roleCode));
  };

  const setSubrole = (roleCode: RoleCode, subrole: string) => {
    // Choosing a specialization for a role marked "off" is a clear intent to
    // play it; promote instead of dropping the input on the floor.
    const priority = selections[roleCode].priority === "off" ? "fallback" : selections[roleCode].priority;
    onChange(
      normalize({ ...selections, [roleCode]: { ...selections[roleCode], subrole, priority } }, roleCode),
    );
  };

  const setHeroes = (roleCode: RoleCode, topHeroes: string[]) => {
    const priority =
      selections[roleCode].priority === "off" && topHeroes.length > 0
        ? "fallback"
        : selections[roleCode].priority;
    onChange(
      normalize({ ...selections, [roleCode]: { ...selections[roleCode], topHeroes, priority } }, roleCode),
    );
  };

  const toggleFlex = () => {
    const next = { ...selections };
    if (isFlex) {
      const [first, ...rest] = ROLES;
      next[first.code] = { ...next[first.code], priority: "main" };
      for (const role of rest) {
        next[role.code] = { ...next[role.code], priority: "fallback" };
      }
    } else {
      for (const role of ROLES) {
        next[role.code] = { ...next[role.code], priority: "main" };
      }
    }
    onChange(next);
  };

  /**
   * The `all_roles` choice: one priority role, or flex. Every role stays
   * playable either way — only comfort changes, so the non-chosen roles become
   * `fallback` rather than `off`.
   */
  const setPriorityChoice = (choice: RoleCode | "flex") => {
    const next = { ...selections };
    for (const role of ROLES) {
      next[role.code] = {
        ...next[role.code],
        priority: choice === "flex" || role.code === choice ? "main" : "fallback",
      };
    }
    onChange(next);
  };

  const columnClass = showPriority
    ? "sm:grid-cols-[minmax(6rem,0.8fr)_minmax(0,13rem)_minmax(0,1fr)_minmax(0,8.5rem)]"
    : "sm:grid-cols-[minmax(6rem,0.8fr)_minmax(0,1fr)_minmax(0,8.5rem)]";

  const priorityOptions: readonly SegmentedOption<RoleCode | "flex">[] = [
    ...ROLES.map((role) => ({
      value: role.code as RoleCode | "flex",
      label: role.display,
      selectedClassName: (ROLE_ACCENTS[role.code] ?? ROLE_ACCENTS.flex).tile,
    })),
    {
      value: "flex" as const,
      label: t("registration.roles.matrix.choiceFlex"),
      selectedClassName: ROLE_ACCENTS.flex.tile,
    },
  ];

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {hideHelperText ? (
          <span />
        ) : (
          <p className="max-w-[38rem] text-xs leading-5 text-[color:var(--aqt-fg-muted)]">
            {isForced
              ? t("registration.roles.matrix.hintForced")
              : isAllRoles
                ? t("registration.roles.matrix.hintAllRoles")
                : isAdditionalRolesRequired
                  ? t("registration.roles.matrix.hintRequired")
                  : t("registration.roles.matrix.hint")}
          </p>
        )}

        {flexMode === "optional" && (
          <button
            type="button"
            aria-pressed={isFlex}
            onClick={toggleFlex}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              isFlex
                ? cn(ROLE_ACCENTS.flex.selectedCard, "text-[color:var(--aqt-fg)]")
                : "border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-overlay-2)] text-[color:var(--aqt-fg-muted)] hover:bg-[color:var(--aqt-overlay-3)]",
            )}
          >
            <FlexIcon width={14} height={14} />
            {t("registration.roles.matrix.flexPreset")}
          </button>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-xs leading-5 text-warning">
          {error}
        </p>
      )}

      {isAllRoles && (
        <div className="grid gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--aqt-fg-muted)]">
            {t("registration.roles.matrix.choiceLabel")}
          </span>
          <SegmentedRadio
            label={t("registration.roles.matrix.choiceLabel")}
            value={priorityChoice(selections)}
            options={priorityOptions}
            onChange={setPriorityChoice}
          />
        </div>
      )}

      <div
        aria-hidden
        className={cn(
          "hidden gap-2 px-2 text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--aqt-fg-muted)] sm:grid",
          columnClass,
        )}
      >
        <span>{t("registration.roles.matrix.columnRole")}</span>
        {showPriority && <span>{t("registration.roles.matrix.columnPriority")}</span>}
        <span>{t("registration.roles.specialization")}</span>
        <span>{topHeroesEnabled ? t("registration.roles.topHeroes.title") : ""}</span>
      </div>

      <div className="grid gap-2">
        {ROLES.map((role) => (
          <RoleMatrixRow
            key={role.code}
            roleCode={role.code}
            roleLabel={role.display}
            selection={selections[role.code]}
            subroleOptions={subroleOptionsFor(role.code, selections[role.code].priority)}
            heroes={heroesForRole(role.code)}
            topHeroesEnabled={topHeroesEnabled}
            maxHeroes={maxHeroes}
            showPriority={showPriority}
            onPriorityChange={(priority) => setPriority(role.code, priority)}
            onSubroleChange={(subrole) => setSubrole(role.code, subrole)}
            onHeroesChange={(heroes) => setHeroes(role.code, heroes)}
          />
        ))}
      </div>
    </div>
  );
}
