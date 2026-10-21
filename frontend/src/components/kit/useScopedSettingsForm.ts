"use client";

import { useCallback, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { ApiError, getApiErrorMessage } from "@/lib/api/error";
import { notify } from "@/lib/notify";

/** Inline error per form key; a key that is fine is absent. */
export type SettingsFieldErrors = Partial<Record<string, string>>;

export interface ScopedSettingsFormOptions<TForm, TPayload> {
  /**
   * The saved values this section edits, read off the server entity — `null`
   * while it loads. Memoise it: a new identity is what re-baselines the form,
   * so an unmemoised derivation would reset the user's typing every render.
   */
  baseline: TForm | null;
  /** The scoped diff this section would send right now. */
  toPayload: (form: TForm, baseline: TForm) => TPayload;
  /**
   * Fields the summary counts; defaults to the payload's keys. Only a section
   * that saves something outside the payload (a second endpoint) needs it.
   */
  countChanges?: (payload: TPayload, form: TForm, baseline: TForm) => number;
  /** Sends the diff. A section with a second endpoint sends that here too. */
  submit: (payload: TPayload, form: TForm, baseline: TForm) => Promise<unknown>;
  /** Re-reads whatever the save invalidated; runs before the toast. */
  onSaved?: () => void;
  /**
   * The section's own checks, keyed like the form, for the errors it renders
   * inline (`SettingRow error`). Opting in also routes a refused save's
   * per-field reasons onto the same keys instead of the save bar.
   *
   * Only changed fields are judged: a value saved before a rule existed must
   * not hold every other edit hostage.
   */
  validate?: (form: TForm) => SettingsFieldErrors;
}

/** Everything a settings section needs to render and save its own fields. */
export interface ScopedSettingsForm<TForm, TPayload> {
  /** `null` only while the entity is still loading. */
  form: TForm | null;
  /** Merges a partial into the form; the only way a section mutates it. */
  patch: (values: Partial<TForm>) => void;
  dirty: boolean;
  /** "2 changed fields" for the `SaveBar` summary. */
  summary: string;
  saving: boolean;
  /** The PATCH body this section would send right now — the diff, scoped. */
  payload: TPayload | null;
  save: () => void;
  discard: () => void;
  /** Inline errors to show now, keyed like the form; empty without `validate`. */
  errors: SettingsFieldErrors;
  /**
   * Shows a field's error once the reader has left it: wire it to the
   * control's `onBlur`, so a half-typed link is not called wrong mid-word.
   */
  reveal: (key: keyof TForm & string) => void;
  /** Why saving is refused or failed, for the `SaveBar`; `null` when it is not. */
  error: string | null;
}

const NOTHING_REVEALED: ReadonlySet<string> = new Set();

/** Pydantic prefixes every custom-validator message with its error type. */
const serverFieldMessage = (msg: string) => msg.replace(/^Value error, /, "");

function changedKeys<TForm>(form: TForm, baseline: TForm): string[] {
  const current = form as Record<string, unknown>;
  const base = baseline as Record<string, unknown>;
  return Object.keys(current).filter(
    (key) => JSON.stringify(current[key]) !== JSON.stringify(base[key])
  );
}

/** After the render that marks them, move focus to the first invalid control. */
function focusFirstInvalid() {
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  });
}

/**
 * Form state of one settings section, and the scoped diff it saves.
 *
 * A section owns a subset of an entity's fields: it diffs what the user typed
 * against the saved entity, reports "what changed" from that diff alone, and
 * PATCHes nothing else. Sending every field a screen holds is how renaming a
 * tournament used to record a full rewrite of its rules and scoring in the
 * audit trail (`model_dump(exclude_unset=True)` records exactly the keys a
 * PATCH sends), so the scoping is the point, not an optimisation.
 *
 * A failed save is reported through `error` for the `SaveBar`, never a toast:
 * the toast landed on top of the bar's own Discard button and named no field.
 *
 * Workspace and tournament settings share this hook; each supplies its own
 * baseline, diff and endpoints.
 */
export function useScopedSettingsForm<TForm, TPayload>({
  baseline,
  toPayload,
  countChanges,
  submit,
  onSaved,
  validate
}: ScopedSettingsFormOptions<TForm, TPayload>): ScopedSettingsForm<TForm, TPayload> {
  const t = useTranslations("admin.saveBar");
  const changesBetween = (form: TForm, base: TForm) => {
    const diff = toPayload(form, base);
    return countChanges
      ? countChanges(diff, form, base)
      : Object.keys(diff as Record<string, unknown>).length;
  };

  const [state, setState] = useState<{ form: TForm; baseline: TForm } | null>(() =>
    baseline === null ? null : { form: baseline, baseline }
  );
  const [revealed, setRevealed] = useState<ReadonlySet<string> | "all">(NOTHING_REVEALED);
  const [serverErrors, setServerErrors] = useState<SettingsFieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);

  // Re-baseline when the entity changes under us: our own refetch after a save,
  // another admin's write arriving through an invalidation, or the entity
  // simply loading in. Done during render rather than in an effect, because an
  // effect would first commit a render whose `dirty` and `payload` compare the
  // new baseline against the old form and briefly report phantom changed
  // fields.
  if (baseline !== null && state?.baseline !== baseline) {
    setState((current) => {
      // A refetch always re-baselines, but only replaces the form while the
      // user has nothing unsaved to lose.
      if (current && changesBetween(current.form, current.baseline) > 0) {
        return { form: current.form, baseline };
      }
      return { form: baseline, baseline };
    });
  }

  const payload = state ? toPayload(state.form, state.baseline) : null;
  const changedCount = state ? changesBetween(state.form, state.baseline) : 0;

  const blocking: SettingsFieldErrors = {};
  if (state && validate) {
    const found = validate(state.form);
    for (const key of changedKeys(state.form, state.baseline)) {
      if (found[key]) blocking[key] = found[key];
    }
  }
  const errors: SettingsFieldErrors = { ...serverErrors };
  for (const [key, message] of Object.entries(blocking)) {
    if (revealed === "all" || revealed.has(key)) errors[key] = message;
  }
  const invalidCount = Object.keys(errors).length;

  const resetFeedback = () => {
    setRevealed(NOTHING_REVEALED);
    setServerErrors({});
    setFailure(null);
  };

  const mutation = useMutation({
    mutationFn: async () => {
      if (!state || payload === null) return;
      await submit(payload, state.form, state.baseline);
    },
    onSuccess: () => {
      resetFeedback();
      onSaved?.();
      notify.success(t("saved"));
    },
    onError: (error) => {
      const form = state?.form as Record<string, unknown> | undefined;
      if (validate && form && error instanceof ApiError) {
        const byField: SettingsFieldErrors = {};
        for (const detail of error.details) {
          if (detail.field && detail.field in form) {
            byField[detail.field] = serverFieldMessage(detail.msg);
          }
        }
        if (Object.keys(byField).length > 0) {
          setServerErrors(byField);
          setFailure(null);
          focusFirstInvalid();
          return;
        }
      }
      setFailure(getApiErrorMessage(error, t("saveFailed")));
    }
  });

  const patch = useCallback((values: Partial<TForm>) => {
    setState((current) =>
      current ? { ...current, form: { ...current.form, ...values } } : current
    );
    setFailure(null);
    setServerErrors((current) => {
      const keys = Object.keys(values).filter((key) => key in current);
      if (keys.length === 0) return current;
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
  }, []);

  const discard = useCallback(() => {
    setState((current) => (current ? { ...current, form: current.baseline } : current));
    setRevealed(NOTHING_REVEALED);
    setServerErrors({});
    setFailure(null);
  }, []);

  const reveal = useCallback((key: keyof TForm & string) => {
    setRevealed((current) =>
      current === "all" || current.has(key) ? current : new Set(current).add(key)
    );
  }, []);

  const save = () => {
    if (Object.keys(blocking).length > 0) {
      setRevealed("all");
      focusFirstInvalid();
      return;
    }
    mutation.mutate();
  };

  return {
    form: state?.form ?? null,
    patch,
    dirty: changedCount > 0,
    summary: t("changedFields", { count: changedCount }),
    saving: mutation.isPending,
    payload,
    save,
    discard,
    errors,
    reveal,
    error: failure ?? (invalidCount > 0 ? t("fixFields", { count: invalidCount }) : null)
  };
}
