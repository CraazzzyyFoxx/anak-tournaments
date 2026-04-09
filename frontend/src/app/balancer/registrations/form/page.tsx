"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";

import { useBalancerTournamentId } from "@/app/balancer/_components/useBalancerTournamentId";
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
  AdminRegistrationFormUpsert,
  BuiltInFieldConfig,
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
}

const BUILT_IN_FIELDS: BuiltInFieldDef[] = [
  { key: "battle_tag", label: "BattleTag", description: "Battle.net tag (e.g. Player#1234)", defaultEnabled: true, defaultRequired: true },
  { key: "smurf_tags", label: "Smurf Accounts", description: "Additional BattleTag accounts (smurfs)", defaultEnabled: false, defaultRequired: false },
  { key: "discord_nick", label: "Discord", description: "Discord username", defaultEnabled: true, defaultRequired: false },
  { key: "twitch_nick", label: "Twitch", description: "Twitch channel name", defaultEnabled: true, defaultRequired: false },
  { key: "primary_role", label: "Primary Role", description: "Main role (tank/dps/support) with subrole selection", defaultEnabled: true, defaultRequired: false, hasSubroles: true },
  { key: "additional_roles", label: "Additional Roles", description: "Secondary roles the player can fill", defaultEnabled: false, defaultRequired: false, hasSubroles: true },
  { key: "stream_pov", label: "Stream POV", description: "Player will stream their POV", defaultEnabled: false, defaultRequired: false },
  { key: "notes", label: "Notes", description: "Free-text notes from the player", defaultEnabled: true, defaultRequired: false },
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
    { value: "flanker", label: "Flanker" },
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
    result[field.key] = existing ?? {
      enabled: field.defaultEnabled,
      required: field.defaultRequired,
    };
    // Ensure subroles have defaults for role fields
    if (field.hasSubroles && !result[field.key].subroles) {
      result[field.key] = { ...result[field.key], subroles: { ...DEFAULT_SUBROLE_OPTIONS } };
    }
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
    if (formQuery.data) {
      setIsOpen(formQuery.data.is_open);
      setAutoApprove(formQuery.data.auto_approve ?? false);
      setBuiltInFields(getBuiltInConfig(formQuery.data.built_in_fields_json ?? {}));
      setCustomFields(formQuery.data.custom_fields_json ?? []);
      setHasChanges(false);
    }
  }, [formQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!tournamentId) throw new Error("No tournament selected");
      const payload: AdminRegistrationFormUpsert = {
        is_open: isOpen,
        auto_approve: autoApprove,
        built_in_fields: builtInFields,
        custom_fields: customFields,
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
      [key]: { ...prev[key], ...updates },
    }));
    setHasChanges(true);
  };

  const addCustomField = () => {
    setCustomFields((prev) => [
      ...prev,
      { key: "", label: "", type: "text", required: false, placeholder: null, options: null },
    ]);
    setHasChanges(true);
  };

  const updateCustomField = (index: number, updates: Partial<AdminCustomFieldDef>) => {
    setCustomFields((prev) =>
      prev.map((f, i) => {
        if (i !== index) return f;
        const updated = { ...f, ...updates };
        if ("label" in updates && updates.label !== undefined) {
          updated.key = updates.label
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_|_$/g, "");
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
