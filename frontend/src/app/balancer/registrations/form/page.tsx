"use client";

import { startTransition, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";

import { useBalancerTournamentId } from "@/app/balancer/components/useBalancerTournamentId";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import balancerAdminService from "@/services/balancer-admin.service";
import type {
  AdminCustomFieldDef,
  AdminRegistrationForm,
  AdminRegistrationFormUpsert,
  BuiltInFieldConfig,
  FieldValidationConfig,
} from "@/types/balancer-admin.types";

// ---------------------------------------------------------------------------
// Built-in field definitions
// ---------------------------------------------------------------------------

interface BuiltInFieldDef {
  key: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
  defaultRequired: boolean;
  hasSubroles?: boolean;
  supportsValidation?: boolean;
  defaultValidation?: FieldValidationConfig;
}

const DEFAULT_BATTLE_TAG_REGEX = String.raw`([\w0-9]{2,12}#[0-9]{4,})`;
const DEFAULT_DISCORD_REGEX = String.raw`^[a-z0-9_.]{2,32}$`;
const DEFAULT_TWITCH_REGEX = String.raw`^[a-z0-9_]{4,25}$`;
const DEFAULT_URL_REGEX = String.raw`^https?://.+$`;
const DEFAULT_NUMBER_REGEX = String.raw`^-?\d+(?:[.,]\d+)?$`;

const BUILT_IN_FIELDS: BuiltInFieldDef[] = [
  {
    key: "battle_tag",
    label: "BattleTag",
    description: "Battle.net tag (e.g. Player#1234)",
    defaultEnabled: true,
    defaultRequired: true,
    supportsValidation: true,
    defaultValidation: {
      regex: DEFAULT_BATTLE_TAG_REGEX,
      error_message: "BattleTag must match Player#1234.",
    },
  },
  {
    key: "smurf_tags",
    label: "Smurf Accounts",
    description: "Additional BattleTag accounts (smurfs)",
    defaultEnabled: false,
    defaultRequired: false,
    supportsValidation: true,
    defaultValidation: {
      regex: DEFAULT_BATTLE_TAG_REGEX,
      error_message: "Each smurf BattleTag must match Player#1234.",
    },
  },
  {
    key: "discord_nick",
    label: "Discord",
    description: "Discord username",
    defaultEnabled: true,
    defaultRequired: false,
    supportsValidation: true,
    defaultValidation: {
      regex: DEFAULT_DISCORD_REGEX,
      error_message: "Discord username must contain 2-32 lowercase letters, digits, underscores, or dots.",
    },
  },
  {
    key: "twitch_nick",
    label: "Twitch",
    description: "Twitch channel name",
    defaultEnabled: true,
    defaultRequired: false,
    supportsValidation: true,
    defaultValidation: {
      regex: DEFAULT_TWITCH_REGEX,
      error_message: "Twitch channel name must contain 4-25 lowercase letters, digits, or underscores.",
    },
  },
  { key: "primary_role", label: "Primary Role", description: "Main role (tank/dps/support) with subrole selection", defaultEnabled: true, defaultRequired: false, hasSubroles: true },
  { key: "additional_roles", label: "Additional Roles", description: "Secondary roles the player can fill", defaultEnabled: false, defaultRequired: false, hasSubroles: true },
  { key: "stream_pov", label: "Stream POV", description: "Player will stream their POV", defaultEnabled: false, defaultRequired: false },
  {
    key: "notes",
    label: "Notes",
    description: "Free-text notes from the player",
    defaultEnabled: true,
    defaultRequired: false,
    supportsValidation: true,
  },
];

const DEFAULT_SUBROLE_OPTIONS: Record<string, string[]> = {
  tank: [],
  dps: ["hitscan", "projectile"],
  support: ["main_heal", "light_heal"],
};

const ALL_SUBROLE_OPTIONS: Record<string, { value: string; label: string }[]> = {
  tank: [
    { value: "main_tank", label: "Main Tank" },
    { value: "off_tank", label: "Off Tank" },
  ],
  dps: [
    { value: "hitscan", label: "Hitscan" },
    { value: "projectile", label: "Projectile" },
    { value: "main_dps", label: "Main DPS" },
    { value: "flex_dps", label: "Flex DPS" },
  ],
  support: [
    { value: "main_heal", label: "Main Heal" },
    { value: "light_heal", label: "Light Heal" },
    { value: "flex_support", label: "Flex Support" },
  ],
};

function getBuiltInConfig(
  saved: Record<string, BuiltInFieldConfig>,
): Record<string, BuiltInFieldConfig> {
  const result: Record<string, BuiltInFieldConfig> = {};
  for (const field of BUILT_IN_FIELDS) {
    const existing = saved[field.key];
    const next: BuiltInFieldConfig = existing ? { ...existing } : {
      enabled: field.defaultEnabled,
      required: field.defaultRequired,
    };
    if (field.hasSubroles && !next.subroles) {
      next.subroles = { ...DEFAULT_SUBROLE_OPTIONS };
    } else if (next.subroles) {
      next.subroles = { ...next.subroles };
    }
    next.validation = mergeDefaultValidation(next.validation, field.defaultValidation);
    result[field.key] = next;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Custom field types
// ---------------------------------------------------------------------------

const FIELD_TYPE_OPTIONS = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "url", label: "URL" },
  { value: "select", label: "Select" },
  { value: "checkbox", label: "Checkbox" },
] as const;

// ---------------------------------------------------------------------------
// Subroles config per role
// ---------------------------------------------------------------------------

const ROLE_DISPLAY: Record<string, string> = {
  tank: "Tank",
  dps: "DPS",
  support: "Support",
};

function normalizeValidation(
  validation?: FieldValidationConfig | null,
): FieldValidationConfig | null {
  const regex = validation?.regex?.trim() || null;
  const error_message = validation?.error_message?.trim() || null;
  if (!regex && !error_message) {
    return null;
  }
  return {
    ...(regex ? { regex } : {}),
    ...(error_message ? { error_message } : {}),
  };
}

function mergeDefaultValidation(
  validation?: FieldValidationConfig | null,
  defaultValidation?: FieldValidationConfig | null,
): FieldValidationConfig | null {
  const normalized = normalizeValidation(validation);
  const normalizedDefault = normalizeValidation(defaultValidation);
  if (!normalizedDefault) {
    return normalized;
  }

  return normalizeValidation({
    regex: normalized?.regex ?? normalizedDefault.regex ?? null,
    error_message: normalized?.error_message ?? normalizedDefault.error_message ?? null,
  });
}

function getCustomFieldDefaultValidation(
  type: AdminCustomFieldDef["type"],
): FieldValidationConfig | null {
  switch (type) {
    case "url":
      return {
        regex: DEFAULT_URL_REGEX,
        error_message: "Value must start with http:// or https://.",
      };
    case "number":
      return {
        regex: DEFAULT_NUMBER_REGEX,
        error_message: "Enter a valid number.",
      };
    default:
      return null;
  }
}

function hydrateCustomField(field: AdminCustomFieldDef): AdminCustomFieldDef {
  return {
    ...field,
    validation: mergeDefaultValidation(
      field.validation,
      getCustomFieldDefaultValidation(field.type),
    ),
  };
}

function supportsCustomFieldValidation(type: AdminCustomFieldDef["type"]): boolean {
  return type === "text" || type === "number" || type === "url";
}

function SubrolesConfig({
  subroles,
  onChange,
}: {
  subroles: Record<string, string[]>;
  onChange: (subroles: Record<string, string[]>) => void;
}) {
  const toggleSubrole = (role: string, sub: string) => {
    const current = subroles[role] ?? [];
    const next = current.includes(sub)
      ? current.filter((s) => s !== sub)
      : [...current, sub];
    onChange({ ...subroles, [role]: next });
  };

  return (
    <div className="mt-3 space-y-2 rounded-md border border-dashed border-border/60 p-3">
      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
        Available subroles per role
      </p>
      {Object.entries(ALL_SUBROLE_OPTIONS).map(([role, options]) => (
        <div key={role} className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground">
            {ROLE_DISPLAY[role]}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {options.map((opt) => {
              const active = (subroles[role] ?? []).includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggleSubrole(role, opt.value)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                    active
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "border-border/60 text-muted-foreground hover:bg-muted/50",
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
            {options.length === 0 && (
              <span className="text-xs text-muted-foreground/50 italic">No subroles available</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RegistrationFormConfigPage() {
  const tournamentId = useBalancerTournamentId();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isOpen, setIsOpen] = useState(false);
  const [autoApprove, setAutoApprove] = useState(false);
  const [builtInFields, setBuiltInFields] = useState<Record<string, BuiltInFieldConfig>>(() =>
    getBuiltInConfig({}),
  );
  const [customFields, setCustomFields] = useState<AdminCustomFieldDef[]>([]);
  const [hasChanges, setHasChanges] = useState(false);

  const formQuery = useQuery({
    queryKey: ["balancer-admin", "registration-form", tournamentId],
    queryFn: () => balancerAdminService.getRegistrationForm(tournamentId as number),
    enabled: tournamentId !== null,
  });

  useEffect(() => {
    const data = formQuery.data;
    if (data) {
      startTransition(() => {
        setIsOpen(data.is_open);
        setAutoApprove(data.auto_approve ?? false);
        setBuiltInFields(getBuiltInConfig(data.built_in_fields_json ?? {}));
        setCustomFields((data.custom_fields_json ?? []).map(hydrateCustomField));
        setHasChanges(false);
      });
    }
  }, [formQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!tournamentId) throw new Error("No tournament selected");
      const payload: AdminRegistrationFormUpsert = {
        is_open: isOpen,
        auto_approve: autoApprove,
        built_in_fields: Object.fromEntries(
          Object.entries(builtInFields).map(([key, value]) => [
            key,
            {
              ...value,
              validation: normalizeValidation(value.validation),
            },
          ]),
        ),
        custom_fields: customFields.map((field) => ({
          ...field,
          validation: normalizeValidation(field.validation),
        })),
      };
      return balancerAdminService.upsertRegistrationForm(tournamentId, payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["balancer-admin", "registration-form", tournamentId] });
      setHasChanges(false);
      toast({ title: "Registration form saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    },
  });

  const updateBuiltIn = (key: string, updates: Partial<BuiltInFieldConfig>) => {
    setBuiltInFields((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        ...updates,
        ...(Object.prototype.hasOwnProperty.call(updates, "validation")
          ? { validation: normalizeValidation(updates.validation) }
          : {}),
      },
    }));
    setHasChanges(true);
  };

  const addCustomField = () => {
    setCustomFields((prev) => [
      ...prev,
      {
        key: "",
        label: "",
        type: "text",
        required: false,
        placeholder: null,
        options: null,
        validation: getCustomFieldDefaultValidation("text"),
      },
    ]);
    setHasChanges(true);
  };

  const updateCustomFieldType = (
    field: AdminCustomFieldDef,
    type: AdminCustomFieldDef["type"],
  ): AdminCustomFieldDef => {
    if (!supportsCustomFieldValidation(type)) {
      return { ...field, type, validation: null };
    }

    const currentValidation = normalizeValidation(field.validation);
    const defaultValidation = getCustomFieldDefaultValidation(type);

    return {
      ...field,
      type,
      validation: mergeDefaultValidation(currentValidation, defaultValidation),
    };
  };

  const updateCustomField = (index: number, updates: Partial<AdminCustomFieldDef>) => {
    setCustomFields((prev) =>
      prev.map((f, i) => {
        if (i !== index) return f;
        let updated = { ...f, ...updates };

        if ("type" in updates && updates.type) {
          updated = updateCustomFieldType(updated, updates.type);
        }

        if ("label" in updates && updates.label !== undefined) {
          updated.key = updates.label
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_|_$/g, "");
        }
        if ("validation" in updates) {
          updated.validation = normalizeValidation(updates.validation);
        }
        return updated;
      }),
    );
    setHasChanges(true);
  };

  const removeCustomField = (index: number) => {
    setCustomFields((prev) => prev.filter((_, i) => i !== index));
    setHasChanges(true);
  };

  if (!tournamentId) {
    return (
      <Alert>
        <AlertTitle>Select a tournament</AlertTitle>
        <AlertDescription>Choose a tournament in the sidebar before configuring the registration form.</AlertDescription>
      </Alert>
    );
  }

  const formExists = formQuery.data != null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto">
      {/* Registration status */}
      <Card>
        <CardHeader>
          <CardTitle>Registration Status</CardTitle>
          <CardDescription>Control whether players can register for this tournament.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Accept registrations</Label>
              <p className="text-xs text-muted-foreground">
                When enabled, the registration form will be visible on the tournament page.
              </p>
            </div>
            <Switch
              checked={isOpen}
              onCheckedChange={(checked) => {
                setIsOpen(checked);
                setHasChanges(true);
              }}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Auto-approve</Label>
              <p className="text-xs text-muted-foreground">
                Skip manual review. Registrations are approved instantly and players are added to the pool automatically.
              </p>
            </div>
            <Switch
              checked={autoApprove}
              onCheckedChange={(checked) => {
                setAutoApprove(checked);
                setHasChanges(true);
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Built-in fields */}
      <Card>
        <CardHeader>
          <CardTitle>Built-in Fields</CardTitle>
          <CardDescription>Toggle which standard fields appear on the registration form.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="divide-y rounded-lg border">
            {BUILT_IN_FIELDS.map((def) => {
              const cfg = builtInFields[def.key] ?? { enabled: def.defaultEnabled, required: def.defaultRequired };
              return (
                <div key={def.key} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{def.label}</span>
                        {cfg.required && cfg.enabled && (
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                            Required
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{def.description}</p>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      {cfg.enabled && (
                        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Switch
                            checked={cfg.required}
                            onCheckedChange={(checked) => updateBuiltIn(def.key, { required: checked })}
                            className="scale-75"
                          />
                          Required
                        </label>
                      )}
                      <Switch
                        checked={cfg.enabled}
                        onCheckedChange={(checked) =>
                          updateBuiltIn(def.key, { enabled: checked, ...(checked ? {} : { required: false }) })
                        }
                      />
                    </div>
                  </div>
                  {/* Subroles config for role fields */}
                  {def.hasSubroles && cfg.enabled && (
                    <SubrolesConfig
                      subroles={cfg.subroles ?? DEFAULT_SUBROLE_OPTIONS}
                      onChange={(subroles) => updateBuiltIn(def.key, { subroles })}
                    />
                  )}
                  {def.supportsValidation && cfg.enabled && (
                    <div className="mt-3 grid gap-3 rounded-md border border-dashed border-border/60 p-3 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Regex pattern</Label>
                        <Input
                          value={cfg.validation?.regex ?? ""}
                          onChange={(e) =>
                            updateBuiltIn(def.key, {
                              validation: {
                                ...cfg.validation,
                                regex: e.target.value || null,
                              },
                            })
                          }
                          placeholder={def.defaultValidation?.regex ?? "^[a-z0-9_]+$"}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Error message</Label>
                        <Input
                          value={cfg.validation?.error_message ?? ""}
                          onChange={(e) =>
                            updateBuiltIn(def.key, {
                              validation: {
                                ...cfg.validation,
                                error_message: e.target.value || null,
                              },
                            })
                          }
                          placeholder={`Shown when ${def.label} is invalid`}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Custom fields */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Custom Fields</CardTitle>
              <CardDescription>Add extra fields like Boosty nick, VK link, YouTube, etc.</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={addCustomField}>
              <Plus className="mr-1.5 size-3.5" />
              Add field
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {customFields.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/60 py-10 text-center">
              <p className="text-sm text-muted-foreground">No custom fields yet.</p>
              <p className="mt-1 text-xs text-muted-foreground/60">
                Click &quot;Add field&quot; to create fields like Boosty, VK, YouTube, etc.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {customFields.map((field, index) => (
                <div key={index} className="rounded-lg border p-4">
                  <div className="grid gap-3 sm:grid-cols-[1fr_140px_140px_auto]">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Label</Label>
                      <Input
                        value={field.label}
                        onChange={(e) => updateCustomField(index, { label: e.target.value })}
                        placeholder="e.g. Boosty nick"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Type</Label>
                      <Select
                        value={field.type}
                        onValueChange={(v) =>
                          updateCustomField(index, { type: v as AdminCustomFieldDef["type"] })
                        }
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {FIELD_TYPE_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Placeholder</Label>
                      <Input
                        value={field.placeholder ?? ""}
                        onChange={(e) => updateCustomField(index, { placeholder: e.target.value || null })}
                        placeholder="Hint text..."
                      />
                    </div>
                    <div className="flex items-end gap-2">
                      <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
                        <Switch
                          checked={field.required}
                          onCheckedChange={(checked) => updateCustomField(index, { required: checked })}
                        />
                        <Label className="text-xs text-muted-foreground whitespace-nowrap">Required</Label>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-9 shrink-0 text-destructive hover:text-destructive"
                        onClick={() => removeCustomField(index)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                  {field.type === "select" && (
                    <div className="mt-3 space-y-1.5">
                      <Label className="text-xs">Options (one per line)</Label>
                      <textarea
                        className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                        rows={3}
                        value={(field.options ?? []).join("\n")}
                        onChange={(e) =>
                          updateCustomField(index, {
                            options: e.target.value.split("\n").filter((l) => l.trim()),
                          })
                        }
                        placeholder={"Option A\nOption B\nOption C"}
                      />
                    </div>
                  )}
                  {supportsCustomFieldValidation(field.type) && (
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Regex pattern</Label>
                        <Input
                          value={field.validation?.regex ?? ""}
                          onChange={(e) =>
                            updateCustomField(index, {
                              validation: {
                                ...field.validation,
                                regex: e.target.value || null,
                              },
                            })
                          }
                          placeholder={getCustomFieldDefaultValidation(field.type)?.regex ?? "^[a-z0-9_]{3,}$"}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Error message</Label>
                        <Input
                          value={field.validation?.error_message ?? ""}
                          onChange={(e) =>
                            updateCustomField(index, {
                              validation: {
                                ...field.validation,
                                error_message: e.target.value || null,
                              },
                            })
                          }
                          placeholder={
                            getCustomFieldDefaultValidation(field.type)?.error_message
                            ?? `Shown when ${field.label || "field"} is invalid`
                          }
                        />
                      </div>
                    </div>
                  )}
                  {field.key && (
                    <p className="mt-2 text-[10px] font-mono text-muted-foreground/50">key: {field.key}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Save */}
      <div className="flex justify-end pb-4">
        <Button
          size="lg"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || (!hasChanges && formExists)}
        >
          {saveMutation.isPending ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Save className="mr-2 size-4" />
          )}
          {formExists ? "Save changes" : "Create form"}
        </Button>
      </div>
    </div>
  );
}
