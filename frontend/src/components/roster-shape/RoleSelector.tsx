"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { useRoleName } from "@/hooks/useRoleName";
import { ratedDimension, selectableRoles, selectedRoleRefs, type RoleOntology, type RoleSelection } from "@/lib/roster/ontology";

/** Radio/checkbox semantics come from the declared dimension, not a game's role count. */
export function RoleSelector({ ontology, dimension, value, onChange, disabled = false }: Readonly<{
  ontology: RoleOntology;
  dimension: string;
  value: RoleSelection;
  onChange: (value: RoleSelection) => void;
  disabled?: boolean;
}>) {
  const id = useId();
  const t = useTranslations("common.roleOntology");
  const nameOf = useRoleName();
  const axis = ontology.dimensions.find(row => row.code === dimension && row.active);
  if (!ratedDimension(ontology) || !axis) return <p role="alert">{t("metadataError")}</p>;
  const selected = selectedRoleRefs(ontology, value, dimension);
  return <fieldset disabled={disabled} className="space-y-2">
    <legend className="text-sm font-medium">{axis.name}</legend>
    {selectableRoles(ontology, dimension).map(role => <label key={role.id} className="flex items-center gap-2 text-sm">
      <input type={axis.selection_mode === "single" ? "radio" : "checkbox"} name={id} checked={selected.some(ref => ref.role === role.code)}
        onChange={event => {
          const refs = selected.filter(ref => ref.role !== role.code);
          if (event.target.checked) refs.push({ dimension, role: role.code });
          onChange({ discipline: ontology.discipline.code, workspace_id: ontology.workspace_id, refs: axis.selection_mode === "single" ? [{ dimension, role: role.code }] : refs });
        }} />
      <PlayerRoleIcon role={{ dimension, role: role.code }} ontology={ontology} size={18} decorative />{nameOf(role)}
    </label>)}
    {axis.selection_mode === "single" && <button type="button" className="text-xs underline" onClick={() => onChange({ discipline: ontology.discipline.code, workspace_id: ontology.workspace_id, refs: [] })}>{t("clear")}</button>}
  </fieldset>;
}
