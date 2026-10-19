"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { useRoleName } from "@/hooks/useRoleName";
import { findRole, ratedDimension, selectableRoles, type RoleOntology } from "@/lib/roster/ontology";
import { teamFormatPayload, type TeamFormatWrite, type TeamFormatDimension, type TeamFormatRule } from "@/lib/roster/team-format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Edits the native P2 format. No slot-map projection is ever used as an editable source. */
export function TeamFormatEditor({ value, ontology, presets, onChange, disabled = false, locked = false }: Readonly<{
  value: TeamFormatWrite;
  ontology: RoleOntology;
  presets: readonly TeamFormatWrite[];
  onChange: (value: TeamFormatWrite) => void;
  disabled?: boolean;
  locked?: boolean;
}>) {
  const id = useId();
  const t = useTranslations("common.roleOntology");
  const nameOf = useRoleName();
  if (!ratedDimension(ontology)) return <p role="alert">{t("metadataError")}</p>;
  const patch = (next: Partial<TeamFormatWrite>) => onChange({ ...value, ...next });
  const numberField = (label: string, current: number | null | undefined, update: (next: number | null) => void, min = 0) => (
    <label className="grid gap-1 text-xs"><span>{label}</span><Input type="number" step={1} min={min} aria-label={label}
      value={current ?? ""} onChange={event => update(event.target.value === "" ? null : Number(event.target.value))} className="h-8 w-28" /></label>
  );
  const updateDimension = (dimension: string, next: Partial<TeamFormatDimension>) => {
    const exists = value.dimensions.some(entry => entry.dimension === dimension);
    patch({ dimensions: exists ? value.dimensions.map(entry => entry.dimension === dimension ? { ...entry, ...next } : entry)
      : [...value.dimensions, { dimension, mode: "off", ...next }] });
  };
  const updateRule = (index: number, next: Partial<TeamFormatRule>) => patch({ rules: value.rules.map((rule, i) => i === index ? { ...rule, ...next } : rule) });
  return <fieldset disabled={disabled || locked} className="space-y-6 rounded-xl border p-4">
    <legend className="px-2 font-medium">{t("formatTitle")}</legend>
    {locked && <p role="status">{t("locked")}</p>}
    {presets.length > 0 && <label className="grid gap-1 text-sm">{t("preset")}
      <select className="rounded-md border bg-background p-2" aria-label={t("preset")} value="" onChange={event => {
        const preset = presets[Number(event.target.value)];
        if (preset) onChange(teamFormatPayload(preset));
      }}><option value="" disabled>{t("choosePreset")}</option>{presets.map((preset, index) => <option key={preset.preset_code ?? index} value={index}>{preset.name}</option>)}</select>
    </label>}
    <label className="grid gap-1 text-sm">{t("formatName")}<Input value={value.name} maxLength={128} onChange={event => patch({ name: event.target.value })} /></label>
    <div className="flex flex-wrap gap-3">
      {numberField(t("starterMin"), value.starter_min, next => patch({ starter_min: next ?? 0 }), 1)}
      {numberField(t("starterMax"), value.starter_max, next => patch({ starter_max: next ?? 0 }), 1)}
      {numberField(t("substituteMin"), value.substitute_min, next => patch({ substitute_min: next ?? 0 }))}
      {numberField(t("substituteMax"), value.substitute_max, next => patch({ substitute_max: next ?? 0 }))}
    </div>
    {ontology.dimensions.map(dimension => {
      const entry = value.dimensions.find(row => row.dimension === dimension.code);
      return <fieldset key={dimension.code} disabled={!dimension.active} className="space-y-3 rounded-md border p-3">
        <legend className="px-1 text-sm">{dimension.name} · {t(dimension.selection_mode)}{dimension.rated ? ` · ${t("rated")}` : ""}</legend>
        <label className="grid gap-1 text-xs">{t("mode")}
          <select id={`${id}-${dimension.code}`} aria-label={`${t("mode")}: ${dimension.name}`} className="rounded-md border bg-background p-2" value={entry?.mode ?? "off"}
            onChange={event => updateDimension(dimension.code, { mode: event.target.value as TeamFormatDimension["mode"] })}>
            {(["off", "informational", "preference", "enforced"] as const).map(mode => <option key={mode} value={mode}>{t(mode)}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap gap-3">
          {numberField(`${t("assignmentMin")}: ${dimension.name}`, entry?.player_min_assignments, next => updateDimension(dimension.code, { player_min_assignments: next }))}
          {numberField(`${t("assignmentMax")}: ${dimension.name}`, entry?.player_max_assignments, next => updateDimension(dimension.code, { player_max_assignments: next }))}
        </div>
        {value.rules.map((rule, index) => {
          if (rule.role.dimension !== dimension.code) return null;
          const role = findRole(ontology, rule.role);
          const name = role ? nameOf(role) : rule.role.role;
          return <fieldset key={rule.role.role} className="space-y-2 rounded-md border p-3">
            <legend className="flex items-center gap-2 px-1 text-sm"><PlayerRoleIcon role={rule.role} ontology={ontology} size={18} decorative />{name}</legend>
            <div className="flex flex-wrap gap-3">
              {numberField(`${t("hardMin")}: ${name}`, rule.hard_min, next => updateRule(index, { hard_min: next }))}
              {numberField(`${t("hardMax")}: ${name}`, rule.hard_max, next => updateRule(index, { hard_max: next }))}
              {numberField(`${t("recommendedMin")}: ${name}`, rule.recommended_min, next => updateRule(index, { recommended_min: next }))}
              {numberField(`${t("recommendedMax")}: ${name}`, rule.recommended_max, next => updateRule(index, { recommended_max: next }))}
            </div>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={rule.include_descendants ?? true} onChange={event => updateRule(index, { include_descendants: event.target.checked })} />{t("includeDescendants")}</label>
            <Button type="button" variant="outline" size="sm" onClick={() => patch({ rules: value.rules.filter((_, i) => i !== index) })}>{t("removeRule")}</Button>
          </fieldset>;
        })}
        <label className="grid gap-1 text-xs">{t("addRule")}
          <select aria-label={`${t("addRule")}: ${dimension.name}`} value="" className="rounded-md border bg-background p-2" onChange={event => {
            if (!event.target.value) return;
            const dimensions = entry ? value.dimensions : [...value.dimensions, { dimension: dimension.code, mode: "off" as const }];
            patch({ dimensions, rules: [...value.rules, { role: { dimension: dimension.code, role: event.target.value } }] });
          }}><option value="">{t("chooseRole")}</option>{selectableRoles(ontology, dimension.code).filter(role => !value.rules.some(rule => rule.role.dimension === dimension.code && rule.role.role === role.code)).map(role => <option key={role.id} value={role.code}>{nameOf(role)}</option>)}</select>
        </label>
      </fieldset>;
    })}
    {value.dimensions.filter(entry => !ontology.dimensions.some(d => d.code === entry.dimension)).map(entry => <p key={entry.dimension} role="alert">{t("unknown", { role: entry.dimension })}</p>)}
    <p className="text-xs text-muted-foreground">{t("nullHint")}</p>
  </fieldset>;
}
