"use client";

import { useEffect, useId, useState } from "react";
import { X } from "lucide-react";
import type { BuiltInFieldConfig } from "@/types/registration.types";
import { useTranslations } from "next-intl";
import {
  getBuiltInValueValidationError,
  normalizeBuiltInFieldValue,
} from "./validation";
import FormField from "./FormField";

interface SmurfTagsInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions: string[];
  label?: string;
  icon?: string;
  required?: boolean;
  config?: BuiltInFieldConfig;
  onValidationChange?: (error: string | null) => void;
}

export default function SmurfTagsInput({
  tags,
  onChange,
  suggestions,
  label,
  icon,
  required = false,
  config,
  onValidationChange,
}: Readonly<SmurfTagsInputProps>) {
  const t = useTranslations();
  const inputId = useId();
  const [inputValue, setInputValue] = useState("");
  const trimmedInputValue = inputValue.trim();
  const normalizedInputValue = normalizeBuiltInFieldValue("smurf_tags", inputValue);
  const inputValidationError = trimmedInputValue
    ? getBuiltInValueValidationError("smurf_tags", inputValue, config, t)
    : null;

  useEffect(() => {
    onValidationChange?.(inputValidationError);
  }, [inputValidationError, onValidationChange]);

  const addTag = (tag: string, options?: { clearInput?: boolean }) => {
    const normalized = normalizeBuiltInFieldValue("smurf_tags", tag);
    const validationError = getBuiltInValueValidationError("smurf_tags", tag, config);
    if (!normalized || validationError || tags.includes(normalized)) return;
    onChange([...tags, normalized]);
    if (options?.clearInput ?? true) {
      setInputValue("");
    }
  };

  const removeTag = (index: number) => {
    onChange(tags.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag(inputValue, { clearInput: true });
    }
    if (e.key === "Backspace" && !inputValue && tags.length > 0) {
      removeTag(tags.length - 1);
    }
  };

  const unusedSuggestions = suggestions.filter((s) => !tags.includes(s));

  return (
    <div className="space-y-1.5">
      <FormField
        id={inputId}
        label={label ?? t("registration.accounts.smurfs")}
        required={required}
        icon={
          icon
            ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={icon} alt="" className="size-3.5 object-contain opacity-50" />
              )
            : undefined
        }
        beforeControl={
          tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag, i) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-md border border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-overlay-3)] px-2 py-0.5 text-xs text-[color:var(--aqt-fg-muted)]"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(i)}
                    aria-label={t("registration.accounts.removeSmurf", { tag })}
                    className="ml-0.5 rounded text-[color:var(--aqt-fg-dim)] transition-colors hover:text-[color:var(--aqt-fg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          ) : null
        }
        placeholder={t("registration.accounts.addSmurfPlaceholder")}
        value={inputValue}
        onChange={setInputValue}
        onKeyDown={handleKeyDown}
        error={inputValidationError}
        className="pr-16"
        endAdornment={
          <button
            type="button"
            onClick={() => addTag(inputValue, { clearInput: true })}
            disabled={!trimmedInputValue || Boolean(inputValidationError) || tags.includes(normalizedInputValue)}
            className="absolute right-1 top-1/2 h-7 -translate-y-1/2 rounded-md border border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-overlay-3)] px-2.5 text-xs font-medium text-[color:var(--aqt-fg)] transition-colors hover:bg-[color:var(--aqt-overlay-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("registration.accounts.addSmurfButton")}
          </button>
        }
      />
      {unusedSuggestions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {unusedSuggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => addTag(s, { clearInput: false })}
              className="rounded border border-[color:var(--aqt-border)] bg-[color:var(--aqt-overlay-1)] px-2 py-0.5 text-label text-[color:var(--aqt-fg-dim)] transition-colors hover:bg-[color:var(--aqt-overlay-3)] hover:text-[color:var(--aqt-fg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
