import type {
  BuiltInFieldConfig,
  CustomFieldDefinition,
  FieldValidationConfig,
} from "@/types/registration.types";

const BUILT_IN_LABELS: Record<string, string> = {
  battle_tag: "BattleTag",
  smurf_tags: "Smurf Accounts",
  discord_nick: "Discord",
  twitch_nick: "Twitch",
  notes: "Notes",
};

const TEXT_VALIDATION_FIELD_TYPES = new Set<CustomFieldDefinition["type"]>(["text", "number", "url"]);
const DEFAULT_BATTLE_TAG_REGEX = String.raw`([\w0-9]{2,12}#[0-9]{4,})`;
const DEFAULT_BATTLE_TAG_VALIDATION: FieldValidationConfig = {
  regex: DEFAULT_BATTLE_TAG_REGEX,
};

function normalizeBattleTag(value: string): string {
  return value.trim().replace(/\s*#\s*/g, "#").replace(/\s+/g, "");
}

export function normalizeBuiltInFieldValue(fieldKey: string, value: string): string {
  const trimmed = value.trim();
  if (fieldKey === "battle_tag" || fieldKey === "smurf_tags") {
    return normalizeBattleTag(trimmed);
  }
  return trimmed;
}

function buildRegex(validation?: FieldValidationConfig | null): RegExp | null {
  const pattern = validation?.regex?.trim();
  if (!pattern) {
    return null;
  }

  try {
    return new RegExp(`^(?:${pattern})$`);
  } catch {
    return null;
  }
}

function resolveBuiltInValidation(
  fieldKey: string,
  validation?: FieldValidationConfig | null,
): FieldValidationConfig | null {
  if (validation?.regex?.trim()) {
    return validation;
  }
  if (fieldKey === "battle_tag") {
    return {
      ...DEFAULT_BATTLE_TAG_VALIDATION,
      ...(validation?.error_message?.trim() ? { error_message: validation.error_message } : {}),
    };
  }
  return validation ?? null;
}

function getErrorMessage(
  validation: FieldValidationConfig | null | undefined,
  label: string,
): string {
  return validation?.error_message?.trim() || `${label} format is invalid.`;
}

export function getBuiltInFieldValidationError(
  fieldKey: string,
  value: string,
  config?: BuiltInFieldConfig,
): string | null {
  return getBuiltInValueValidationError(fieldKey, value, config);
}

export function getBuiltInValueValidationError(
  fieldKey: string,
  value: string,
  config?: BuiltInFieldConfig,
): string | null {
  const validation = resolveBuiltInValidation(fieldKey, config?.validation);
  const regex = buildRegex(validation);
  const candidate = normalizeBuiltInFieldValue(fieldKey, value);
  if (!regex || !candidate) {
    return null;
  }
  if (regex.test(candidate)) {
    return null;
  }

  return getErrorMessage(validation, BUILT_IN_LABELS[fieldKey] ?? fieldKey);
}

export function getBuiltInListValidationError(
  fieldKey: string,
  values: string[],
  config?: BuiltInFieldConfig,
): string | null {
  if (values.length === 0) {
    return null;
  }

  for (const value of values) {
    const error = getBuiltInValueValidationError(fieldKey, value, config);
    if (error) {
      return error;
    }
  }

  return null;
}

export function supportsCustomFieldValidation(
  field: Pick<CustomFieldDefinition, "type">,
): boolean {
  return TEXT_VALIDATION_FIELD_TYPES.has(field.type);
}

export function getCustomFieldValidationError(
  field: CustomFieldDefinition,
  value: string,
): string | null {
  if (!supportsCustomFieldValidation(field)) {
    return null;
  }

  const regex = buildRegex(field.validation);
  const rawValue = value.trim();
  if (!regex || !rawValue) {
    return null;
  }

  if (regex.test(rawValue)) {
    return null;
  }

  return getErrorMessage(field.validation, field.label);
}

export function getFirstLiveValidationError(
  fieldErrors: Record<string, string | null | undefined>,
  fieldKeys: string[],
): string | null {
  for (const fieldKey of fieldKeys) {
    const error = fieldErrors[fieldKey];
    if (error) {
      return error;
    }
  }

  return null;
}

export function getStepDisplayValidationError(
  liveValidationError: string | null,
  stepValidationError: string | null,
): string | null {
  if (liveValidationError) {
    return null;
  }

  return stepValidationError;
}
