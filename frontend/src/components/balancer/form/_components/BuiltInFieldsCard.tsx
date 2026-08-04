"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { BuiltInFieldConfig } from "@/types/balancer-admin.types";

import { BUILT_IN_FIELDS } from "./formConfig";

export function BuiltInFieldsCard({
  builtInFields,
  onUpdate
}: {
  builtInFields: Record<string, BuiltInFieldConfig>;
  onUpdate: (key: string, updates: Partial<BuiltInFieldConfig>) => void;
}) {
  const t = useTranslations("registrationFormAdmin.builtInFields");
  const idPrefix = useId();
  const [expandedFields, setExpandedFields] = useState<Record<string, boolean>>({});

  return (
    <Card>
      <CardHeader>
        <CardTitle asChild><h2>{t("title")}</h2></CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="divide-y rounded-lg border">
          {BUILT_IN_FIELDS.map((def) => {
            const cfg = builtInFields[def.key] ?? {
              enabled: def.defaultEnabled,
              required: def.defaultRequired
            };
            const hasSettings = Boolean(
              def.supportsValidation || def.supportsMaxHeroes || def.supportsVerified
            );
            const isExpanded = cfg.enabled && !!expandedFields[def.key];
            const label = t(`defs.${def.key}.label` as Parameters<typeof t>[0]);
            const description = t(`defs.${def.key}.description` as Parameters<typeof t>[0]);

            return (
              <div key={def.key} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <Switch
                    checked={cfg.enabled}
                    onCheckedChange={(checked) => {
                      onUpdate(def.key, {
                        enabled: checked,
                        ...(checked ? {} : { required: false })
                      });
                      if (!checked) {
                        setExpandedFields((prev) => ({ ...prev, [def.key]: false }));
                      }
                    }}
                  />

                  <div className={cn("min-w-0 flex-1", !cfg.enabled && "opacity-70")}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{label}</span>
                      {cfg.require_verified && cfg.enabled && (
                        <span className="rounded border border-success/30 bg-success/10 px-1.5 py-0.5 text-xs font-medium text-success">
                          {t("verifiedBadge")}
                        </span>
                      )}
                    </div>
                    {/* `title` keeps the full description reachable once the row is
                        narrow enough to clip it. */}
                    <p className="truncate text-xs text-muted-foreground" title={description}>
                      {description}
                    </p>
                  </div>

                  {cfg.enabled && def.supportsRequired !== false && (
                    <label className="flex shrink-0 cursor-pointer select-none items-center gap-2 text-xs text-muted-foreground">
                      <Switch
                        checked={cfg.required}
                        onCheckedChange={(checked) => onUpdate(def.key, { required: checked })}
                      />
                      {t("required")}
                    </label>
                  )}

                  {cfg.enabled && hasSettings ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
                      aria-label={t("settingsAria", { field: label })}
                      aria-expanded={isExpanded}
                      onClick={() =>
                        setExpandedFields((prev) => ({ ...prev, [def.key]: !prev[def.key] }))
                      }
                    >
                      <ChevronDown
                        className={cn(
                          "size-4 transition-transform duration-200",
                          isExpanded && "rotate-180 text-primary"
                        )}
                      />
                    </Button>
                  ) : (
                    // Keep row heights aligned whether or not the field has settings.
                    <div className="size-8 shrink-0" aria-hidden />
                  )}
                </div>

                {hasSettings && (
                  <Collapsible open={isExpanded}>
                    <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
                      {/* Indented to the row's label edge (switch 44px + gap 12px) so
                          the panel reads as belonging to that field, not the group. */}
                      <div className="mt-3 space-y-3 rounded-md bg-muted/30 p-3 sm:ml-14">
                        {def.supportsVerified && (
                          <div className="flex items-center justify-between gap-4">
                            <div className="min-w-0">
                              <Label
                                htmlFor={`${idPrefix}-${def.key}-verified`}
                                className="text-xs"
                              >
                                {t("verifiedAccount")}
                              </Label>
                              <p className="max-w-prose text-xs text-muted-foreground">
                                {t("verifiedAccountHelp")}
                              </p>
                            </div>
                            <Switch
                              id={`${idPrefix}-${def.key}-verified`}
                              checked={cfg.require_verified ?? false}
                              onCheckedChange={(checked) =>
                                onUpdate(def.key, { require_verified: checked })
                              }
                            />
                          </div>
                        )}

                        {def.supportsValidation && (
                          <div className="grid gap-3 md:grid-cols-2">
                            <div className="space-y-1">
                              <Label htmlFor={`${idPrefix}-${def.key}-regex`} className="text-xs">
                                {t("regexPattern")}
                              </Label>
                              <Input
                                id={`${idPrefix}-${def.key}-regex`}
                                value={cfg.validation?.regex ?? ""}
                                onChange={(e) =>
                                  onUpdate(def.key, {
                                    validation: {
                                      ...cfg.validation,
                                      regex: e.target.value || null
                                    }
                                  })
                                }
                                placeholder={def.defaultValidation?.regex ?? "^[a-z0-9_]+$"}
                                spellCheck={false}
                                autoCapitalize="none"
                                // A pattern is read character by character: mono keeps
                                // brackets, escapes and quantifiers distinguishable.
                                className="h-8 bg-background/50 font-mono"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor={`${idPrefix}-${def.key}-error`} className="text-xs">
                                {t("errorMessage")}
                              </Label>
                              <Input
                                id={`${idPrefix}-${def.key}-error`}
                                value={cfg.validation?.error_message ?? ""}
                                onChange={(e) =>
                                  onUpdate(def.key, {
                                    validation: {
                                      ...cfg.validation,
                                      error_message: e.target.value || null
                                    }
                                  })
                                }
                                placeholder={t("errorMessagePlaceholder", { field: label })}
                                className="h-8 bg-background/50"
                              />
                            </div>
                          </div>
                        )}

                        {def.supportsMaxHeroes && (
                          <div className="max-w-[10rem] space-y-1">
                            <Label htmlFor={`${idPrefix}-${def.key}-max`} className="text-xs">
                              {t("maxHeroes")}
                            </Label>
                            <NumberInput
                              id={`${idPrefix}-${def.key}-max`}
                              integer
                              min={1}
                              max={20}
                              value={cfg.max_heroes}
                              onValueChange={(next) => onUpdate(def.key, { max_heroes: next })}
                              placeholder="5"
                              className="h-8 bg-background/50 tabular-nums"
                            />
                          </div>
                        )}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
