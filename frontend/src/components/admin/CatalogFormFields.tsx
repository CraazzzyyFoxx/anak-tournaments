"use client";

/**
 * Shared "Name" and "Aliases" dialog fields for the game-catalogue admin
 * pages (maps, heroes, gamemodes). Every catalogue entity renders both the
 * same way, so they live here instead of being copy-pasted three times.
 */

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatAliasesInput, parseAliasesInput } from "@/lib/catalog-aliases";

interface CatalogNameFieldProps {
  id: string;
  value: string | undefined;
  onChange: (value: string) => void;
}

export function CatalogNameField({ id, value, onChange }: Readonly<CatalogNameFieldProps>) {
  const t = useTranslations("adminWorkspace.content.fields");
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{t("name")}</Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} required />
    </div>
  );
}

interface CatalogAliasesFieldProps {
  id: string;
  aliases: string[] | undefined;
  onChange: (aliases: string[]) => void;
  /** Helper copy under the textarea — a plain sentence or a richer fragment. */
  helperText: ReactNode;
}

export function CatalogAliasesField({ id, aliases, onChange, helperText }: Readonly<CatalogAliasesFieldProps>) {
  const t = useTranslations("adminWorkspace.content.fields");
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{t("aliases")}</Label>
      <Textarea
        id={id}
        value={formatAliasesInput(aliases ?? [])}
        onChange={(e) => onChange(parseAliasesInput(e.target.value))}
        rows={5}
      />
      <p className="text-xs text-muted-foreground">{helperText}</p>
    </div>
  );
}
