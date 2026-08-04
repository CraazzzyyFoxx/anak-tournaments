"use client";

import { useState } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { AdminCustomFieldDef } from "@/types/balancer-admin.types";

import { FIELD_TYPE_OPTIONS, getCustomFieldDefaultValidation, supportsCustomFieldValidation } from "./formConfig";

export function CustomFieldsCard({
  customFields,
  onAdd,
  onUpdate,
  onRemove,
}: {
  customFields: AdminCustomFieldDef[];
  onAdd: () => void;
  onUpdate: (index: number, updates: Partial<AdminCustomFieldDef>) => void;
  onRemove: (index: number) => void;
}) {
  const t = useTranslations("registrationFormAdmin.customFields");
  const [expandedFields, setExpandedFields] = useState<Record<number, boolean>>({});

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{t("title")}</CardTitle>
            <CardDescription>{t("description")}</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={onAdd}>
            <Plus className="mr-1.5 size-3.5" />
            {t("addField")}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {customFields.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/60 py-10 text-center">
            <p className="text-sm text-muted-foreground">{t("emptyTitle")}</p>
            <p className="mt-1 text-xs text-muted-foreground/60">{t("emptyHint")}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {customFields.map((field, index) => {
              const hasSettings = field.type === "select" || supportsCustomFieldValidation(field.type);
              const isExpanded = !!expandedFields[index];
              const fieldName = field.label || t("fieldFallback");

              return (
                <div key={field.key || index} className="rounded-lg border p-4">
                  <div className="grid gap-3 sm:grid-cols-[1fr_140px_140px_auto]">
                    <div className="space-y-1.5">
                      <Label className="text-xs">{t("label")}</Label>
                      <Input
                        value={field.label}
                        onChange={(e) => onUpdate(index, { label: e.target.value })}
                        placeholder={t("labelPlaceholder")}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">{t("type")}</Label>
                      <Select
                        value={field.type}
                        onValueChange={(v) => {
                          const nextType = v as AdminCustomFieldDef["type"];
                          onUpdate(index, { type: nextType });
                          const nextHasSettings = nextType === "select" || supportsCustomFieldValidation(nextType);
                          if (nextHasSettings) {
                            setExpandedFields((prev) => ({ ...prev, [index]: true }));
                          }
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FIELD_TYPE_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {t(`types.${opt.value}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">{t("placeholder")}</Label>
                      <Input
                        value={field.placeholder ?? ""}
                        onChange={(e) => onUpdate(index, { placeholder: e.target.value || null })}
                        placeholder={t("placeholderHint")}
                      />
                    </div>
                    <div className="flex items-end gap-2">
                      <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
                        <Switch
                          checked={field.required}
                          onCheckedChange={(checked) => onUpdate(index, { required: checked })}
                        />
                        <Label className="whitespace-nowrap text-xs text-muted-foreground">{t("required")}</Label>
                      </div>
                      {hasSettings && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-9 shrink-0 text-muted-foreground hover:text-foreground"
                          aria-label={t("settingsAria", { field: fieldName })}
                          onClick={() =>
                            setExpandedFields((prev) => ({ ...prev, [index]: !prev[index] }))
                          }
                        >
                          <ChevronDown
                            className={cn(
                              "size-4 transition-transform duration-200",
                              isExpanded && "rotate-180 text-primary"
                            )}
                          />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-9 shrink-0 text-destructive hover:text-destructive"
                        aria-label={t("removeAria", { field: fieldName })}
                        onClick={() => onRemove(index)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                  {hasSettings && (
                    <Collapsible open={isExpanded}>
                      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
                        {field.type === "select" && (
                          <div className="mt-3 space-y-1.5">
                            <Label className="text-xs">{t("options")}</Label>
                            <textarea
                              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                              rows={3}
                              value={(field.options ?? []).join("\n")}
                              onChange={(e) =>
                                onUpdate(index, {
                                  options: e.target.value.split("\n").filter((l) => l.trim()),
                                })
                              }
                              placeholder={t("optionsPlaceholder")}
                            />
                          </div>
                        )}
                        {supportsCustomFieldValidation(field.type) && (
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <div className="space-y-1.5">
                              <Label className="text-xs">{t("regex")}</Label>
                              <Input
                                value={field.validation?.regex ?? ""}
                                onChange={(e) =>
                                  onUpdate(index, {
                                    validation: { ...field.validation, regex: e.target.value || null },
                                  })
                                }
                                placeholder={getCustomFieldDefaultValidation(field.type)?.regex ?? "^[a-z0-9_]{3,}$"}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs">{t("errorMessage")}</Label>
                              <Input
                                value={field.validation?.error_message ?? ""}
                                onChange={(e) =>
                                  onUpdate(index, {
                                    validation: { ...field.validation, error_message: e.target.value || null },
                                  })
                                }
                                placeholder={
                                  getCustomFieldDefaultValidation(field.type)?.error_message
                                  ?? t("errorMessagePlaceholder", { field: fieldName })
                                }
                              />
                            </div>
                          </div>
                        )}
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                  {field.key && (
                    <p className="mt-2 font-mono text-[10px] text-muted-foreground/50">{t("keyLabel", { key: field.key })}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

