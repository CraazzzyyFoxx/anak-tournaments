"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import type { BuiltInFieldConfig } from "@/types/registration.types";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  getBuiltInValueValidationError,
  normalizeBuiltInFieldValue,
} from "./validation";
import { Input } from "@/components/ui/input";
import FieldLabel from "./FieldLabel";
import { fieldControlClass, fieldInvalidClass } from "./FormField";

interface AccountComboboxProps {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  icon?: string;
  required?: boolean;
  fieldKey?: string;
  config?: BuiltInFieldConfig;
  onValidationChange?: (error: string | null) => void;
}

export default function AccountCombobox({
  label,
  placeholder,
  value,
  onChange,
  suggestions,
  icon,
  required = false,
  fieldKey,
  config,
  onValidationChange,
}: AccountComboboxProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const [contentWidth, setContentWidth] = useState<number>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const controlId = useId();
  const errorId = `${controlId}-error`;
  const validationError = fieldKey
    ? getBuiltInValueValidationError(fieldKey, inputValue, config)
    : null;
  const normalizedInputValue = fieldKey
    ? normalizeBuiltInFieldValue(fieldKey, inputValue)
    : inputValue;

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  useEffect(() => {
    onValidationChange?.(validationError);
  }, [onValidationChange, validationError]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const nextWidth = triggerRef.current?.offsetWidth;
    if (nextWidth) {
      setContentWidth(nextWidth);
    }
  }, [open]);

  const handleSelect = (selected: string) => {
    const nextValue = fieldKey ? normalizeBuiltInFieldValue(fieldKey, selected) : selected;
    const nextError = fieldKey ? getBuiltInValueValidationError(fieldKey, selected, config) : null;
    if (nextError) {
      setInputValue(selected);
      return;
    }

    onChange(nextValue);
    setInputValue(nextValue);
    setOpen(false);
  };

  const handleInputChange = (v: string) => {
    setInputValue(v);

    if (!fieldKey) {
      onChange(v);
      return;
    }

    const nextError = getBuiltInValueValidationError(fieldKey, v, config);
    if (!v.trim()) {
      onChange("");
      return;
    }
    if (!nextError) {
      onChange(normalizeBuiltInFieldValue(fieldKey, v));
    }
  };

  const hasSuggestions = suggestions.length > 0;
  const filtered = inputValue
    ? suggestions.filter((s) => s.toLowerCase().includes(inputValue.toLowerCase()))
    : suggestions;

  const iconEl = icon ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={icon} alt="" className="size-3.5 object-contain opacity-50" />
  ) : null;

  return (
    <div className="space-y-1.5">
      <FieldLabel label={label} htmlFor={controlId} required={required} icon={iconEl} />
      {hasSuggestions ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              ref={triggerRef}
              id={controlId}
              type="button"
              role="combobox"
              aria-controls={listboxId}
              aria-expanded={open}
              aria-invalid={Boolean(validationError)}
              aria-describedby={validationError ? errorId : undefined}
              className={cn(
                fieldControlClass,
                "flex h-9 items-center justify-between",
                value ? "text-[color:var(--aqt-fg)]" : "text-[color:var(--aqt-fg-dim)]",
                validationError && fieldInvalidClass,
              )}
            >
              <span className="truncate">{value || placeholder}</span>
              <ChevronsUpDown className="ml-2 size-3.5 shrink-0 text-[color:var(--aqt-fg-dim)]" aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent
            id={listboxId}
            align="start"
            className="p-0"
            style={{ width: contentWidth }}
          >
            <Command>
              <CommandInput
                value={inputValue}
                onValueChange={handleInputChange}
                placeholder={placeholder}
              />
              <CommandList>
                <CommandEmpty>
                  {inputValue
                    ? t("registration.accounts.typeToUseCustom")
                    : t("registration.accounts.noLinkedAccounts")}
                </CommandEmpty>
                <CommandGroup heading={t("registration.accounts.linkedAccounts")}>
                  {filtered.map((s) => (
                    <CommandItem key={s} value={s} onSelect={() => handleSelect(s)}>
                      <span className="flex-1 truncate">{s}</span>
                      <Check className={cn("ml-2 size-4", value === s ? "opacity-100" : "opacity-0")} aria-hidden />
                    </CommandItem>
                  ))}
                </CommandGroup>
                {inputValue && !suggestions.includes(inputValue) && !validationError && (
                  <CommandGroup heading={t("registration.accounts.custom")}>
                    <CommandItem value={normalizedInputValue} onSelect={() => handleSelect(inputValue)}>
                      {t("registration.accounts.useValue", { value: normalizedInputValue })}
                    </CommandItem>
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      ) : (
        <Input
          id={controlId}
          type="text"
          placeholder={placeholder}
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          aria-invalid={Boolean(validationError)}
          aria-describedby={validationError ? errorId : undefined}
          className={cn(fieldControlClass, "h-9", validationError && fieldInvalidClass)}
        />
      )}
      {validationError && (
        <p id={errorId} className="text-xs text-destructive">{validationError}</p>
      )}
    </div>
  );
}
