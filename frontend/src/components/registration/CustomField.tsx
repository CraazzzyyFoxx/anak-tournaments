"use client";

import { useEffect, useId } from "react";
import { useTranslations } from "next-intl";
import type { CustomFieldDefinition } from "@/types/registration.types";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import FieldLabel from "./FieldLabel";
import FormField, { fieldControlClass, fieldInvalidClass } from "./FormField";
import { getCustomFieldValidationError } from "./validation";

interface CustomFieldProps {
  definition: CustomFieldDefinition;
  value: string;
  onChange: (v: string) => void;
  onValidationChange?: (error: string | null) => void;
}

export default function CustomField({
  definition,
  value,
  onChange,
  onValidationChange,
}: Readonly<CustomFieldProps>) {
  const t = useTranslations();
  const id = useId();
  const errorId = `${id}-error`;
  const inputType = definition.type === "number" ? "number" : definition.type === "url" ? "url" : "text";
  const validationError = getCustomFieldValidationError(definition, value);

  useEffect(() => {
    onValidationChange?.(validationError);
  }, [onValidationChange, validationError]);

  const errorNode = validationError ? (
    <p id={errorId} className="text-xs text-destructive">
      {validationError}
    </p>
  ) : null;

  if (definition.type === "select" && definition.options) {
    return (
      <div className="space-y-1.5">
        <FieldLabel label={definition.label} htmlFor={id} required={definition.required} />
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={Boolean(validationError)}
          aria-describedby={validationError ? errorId : undefined}
          className={cn(fieldControlClass, "h-9", validationError && fieldInvalidClass)}
        >
          <option value="">{t("common.selectPlaceholder")}</option>
          {definition.options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
        {errorNode}
      </div>
    );
  }

  if (definition.type === "checkbox") {
    return (
      <div className="space-y-2">
        {/* Radix Switch renders a <button>, so a wrapping <label> would not
            associate. The id/htmlFor pair does. */}
        <div className="flex items-center gap-3">
          <Switch
            id={id}
            checked={value === "true"}
            onCheckedChange={(checked) => onChange(checked ? "true" : "false")}
            aria-invalid={Boolean(validationError)}
            aria-describedby={validationError ? errorId : undefined}
          />
          <FieldLabel label={definition.label} htmlFor={id} required={definition.required} />
        </div>
        {errorNode}
      </div>
    );
  }

  return (
    <FormField
      id={id}
      label={definition.label}
      required={definition.required}
      type={inputType}
      placeholder={definition.placeholder ?? ""}
      value={value}
      onChange={onChange}
      error={validationError}
    />
  );
}
