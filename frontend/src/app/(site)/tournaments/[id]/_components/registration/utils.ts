import type { RegistrationForm } from "@/types/registration.types";
import { DEFAULT_SUBROLES, SUBROLE_LABELS } from "./constants";

export function getSubroleOptions(
  role: string,
  form: RegistrationForm,
  fieldKey: "primary_role" | "additional_roles" = "primary_role",
): { value: string; label: string }[] {
  const roleFieldCfg = form.built_in_fields?.[fieldKey];
  const configuredSubroles = roleFieldCfg?.subroles?.[role];
  const list = configuredSubroles ?? DEFAULT_SUBROLES[role] ?? [];
  return list.map((v) => ({ value: v, label: SUBROLE_LABELS[v] ?? v }));
}
