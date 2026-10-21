// Pure model for the workspace creation wizard (/admin/workspaces/new): a const
// step list, URL-driven navigation and per-step payloads kept free of React.

import type { WizardStepState } from "@/components/kit/WizardShell";
import { ApiError } from "@/lib/api/error";
import { validateSlug, type SlugProblem } from "@/lib/workspace/slug";
import type { Workspace } from "@/types/workspace.types";

export const WIZARD_STEPS = ["basics", "profile", "branding", "discord", "done"] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number];

export type SkippedSteps = Partial<Record<WizardStep, true>>;

/**
 * Where the wizard is, from `?step=` and `?id=`. Both are user-supplied, and
 * every step past basics edits a workspace that already exists, so without a
 * valid id the wizard is on step 1.
 */
export function wizardLocation(
  step: string | null | undefined,
  id: string | null | undefined
): { step: WizardStep; id: number | null } {
  const workspaceId = id && /^\d+$/.test(id) ? Number(id) : null;
  const known = WIZARD_STEPS.find((entry) => entry === step) ?? "basics";
  return { step: workspaceId === null ? "basics" : known, id: workspaceId };
}

export function nextWizardStep(current: WizardStep): WizardStep {
  return WIZARD_STEPS[Math.min(WIZARD_STEPS.length - 1, WIZARD_STEPS.indexOf(current) + 1)];
}

export function previousWizardStep(current: WizardStep): WizardStep {
  return WIZARD_STEPS[Math.max(0, WIZARD_STEPS.indexOf(current) - 1)];
}

/** Rail states for `WizardShell`: behind the active step a step is done or
 * skipped, ahead of it every step is still to do. */
export function railSteps(
  active: WizardStep,
  skipped: SkippedSteps
): { key: WizardStep; state: WizardStepState }[] {
  const activeIndex = WIZARD_STEPS.indexOf(active);
  return WIZARD_STEPS.map((key, index) => ({
    key,
    state:
      index === activeIndex
        ? "current"
        : index > activeIndex
          ? "todo"
          : skipped[key]
            ? "skipped"
            : "done"
  }));
}

export interface BasicsProblems {
  name?: "empty";
  slug?: SlugProblem;
}

/** Codes, not sentences: the step turns each into its own fix. */
export function validateBasics({ name, slug }: { name: string; slug: string }): BasicsProblems {
  const problems: BasicsProblems = {};
  if (!name.trim()) problems.name = "empty";
  const slugProblem = validateSlug(slug);
  if (slugProblem) problems.slug = slugProblem;
  return problems;
}

/**
 * The three refusals of `POST /api/v1/workspaces`, as the backend sends them:
 * machine codes for the two policy refusals, prose for a duplicate slug.
 * Same matching as `/get-workspace`'s `CreateForm`.
 */
export function createRefusal(error: unknown): "limit" | "reserved" | "taken" | null {
  const details = error instanceof ApiError ? error.details : [];
  const codes = details.map((detail) => `${detail.code} ${detail.msg}`).join(" ");
  if (codes.includes("workspace_create_limit_reached")) return "limit";
  if (codes.includes("slug_reserved")) return "reserved";
  if (/slug already exists/i.test(codes)) return "taken";
  return null;
}

/** Blank text -> `null`: the same contract as `workspace-settings/fields.ts`. */
const trimOrNull = (value: string | null | undefined) => value?.trim() || null;

/** Basics revisited after creation: the slug is fixed, name and description
 * are PATCHed when they changed. */
export function basicsPayload(
  form: { name: string; description: string },
  workspace: Workspace
): { name?: string; description?: string } {
  const payload: { name?: string; description?: string } = {};
  const name = form.name.trim();
  const description = form.description.trim();
  if (name !== workspace.name) payload.name = name;
  if (description !== (workspace.description ?? "")) payload.description = description;
  return payload;
}

const PROFILE_TEXT_KEYS = ["tagline", "about", "discord_url", "twitch_url", "boosty_url"] as const;

export type ProfileForm = Record<(typeof PROFILE_TEXT_KEYS)[number] | "timezone", string>;

export type ProfilePayload = Partial<
  Record<(typeof PROFILE_TEXT_KEYS)[number], string | null> & { timezone: string }
>;

export function profileForm(workspace: Workspace): ProfileForm {
  return {
    tagline: workspace.tagline ?? "",
    about: workspace.about ?? "",
    discord_url: workspace.discord_url ?? "",
    twitch_url: workspace.twitch_url ?? "",
    boosty_url: workspace.boosty_url ?? "",
    timezone: workspace.timezone
  };
}

/** Only what changed; an empty object means the step sends nothing. */
export function profilePayload(form: ProfileForm, workspace: Workspace): ProfilePayload {
  const payload: ProfilePayload = {};
  for (const key of PROFILE_TEXT_KEYS) {
    const next = trimOrNull(form[key]);
    if (next !== trimOrNull(workspace[key])) payload[key] = next;
  }
  if (form.timezone !== workspace.timezone) payload.timezone = form.timezone;
  return payload;
}

export const BRAND_SEED_KEYS = [
  "brand_primary",
  "brand_secondary",
  "brand_background",
  "brand_surface"
] as const;

export type BrandingForm = Pick<Workspace, "branding_enabled" | (typeof BRAND_SEED_KEYS)[number]>;

export function brandingForm(workspace: Workspace): BrandingForm {
  return {
    branding_enabled: workspace.branding_enabled,
    brand_primary: workspace.brand_primary,
    brand_secondary: workspace.brand_secondary,
    brand_background: workspace.brand_background,
    brand_surface: workspace.brand_surface
  };
}

export function brandingPayload(form: BrandingForm, workspace: Workspace): Partial<BrandingForm> {
  const payload: Partial<BrandingForm> = {};
  if (form.branding_enabled !== workspace.branding_enabled) {
    payload.branding_enabled = form.branding_enabled;
  }
  for (const key of BRAND_SEED_KEYS) {
    const next = trimOrNull(form[key]);
    if (next !== trimOrNull(workspace[key])) payload[key] = next;
  }
  return payload;
}
