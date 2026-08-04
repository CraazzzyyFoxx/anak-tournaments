"use client";

import { useState } from "react";
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
  const [expandedFields, setExpandedFields] = useState<Record<string, boolean>>({});

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
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

                  <div className={cn("min-w-0 flex-1", !cfg.enabled && "opacity-50")}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{label}</span>
                      {cfg.require_verified && cfg.enabled && (
                        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                          {t("verifiedBadge")}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{description}</p>
                  </div>

                  {cfg.enabled && def.supportsRequired !== false && (
                    <label className="flex shrink-0 cursor-pointer select-none items-center gap-1.5 text-xs text-muted-foreground">
                      <Switch
                        checked={cfg.required}
                        onCheckedChange={(checked) => onUpdate(def.key, { required: checked })}
                        className="scale-75"
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
                      <div className="mt-3 space-y-3 rounded-md bg-muted/30 p-3">
                        {def.supportsVerified && (
                          <div className="flex items-center justify-between gap-4">
                            <div className="min-w-0">
                              <div className="text-xs font-medium">{t("verifiedAccount")}</div>
                              <p className="text-xs text-muted-foreground">
                                {t("verifiedAccountHelp")}
                              </p>
                            </div>
                            <Switch
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
                              <Label className="text-xs">{t("regexPattern")}</Label>
                              <Input
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
                                className="h-8 bg-background/50 text-xs"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">{t("errorMessage")}</Label>
                              <Input
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
                                className="h-8 bg-background/50 text-xs"
                              />
                            </div>
                          </div>
                        )}

                        {def.supportsMaxHeroes && (
                          <div className="max-w-[10rem] space-y-1">
                            <Label className="text-xs">{t("maxHeroes")}</Label>
                            <NumberInput
                              integer
                              min={1}
                              max={20}
                              value={cfg.max_heroes}
                              onValueChange={(next) =>
                                onUpdate(def.key, { max_heroes: next })
                              }
                              placeholder="5"
                              className="h-8 bg-background/50 text-xs"
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
