"use client";

/**
 * Shared "Name" and "Aliases" dialog fields for the game-catalogue admin
 * pages (maps, heroes, gamemodes). Every catalogue entity renders both the
 * same way, so they live here instead of being copy-pasted three times.
 */

import type { ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatAliasesInput, parseAliasesInput } from "@/lib/catalog-aliases";

interface CatalogNameFieldProps {
  id: string;
  value: string | undefined;
  onChange: (value: string) => void;
  placeholder: string;
}

export function CatalogNameField({ id, value, onChange, placeholder }: CatalogNameFieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Name *</Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required
      />
    </div>
  );
}

interface CatalogAliasesFieldProps {
  id: string;
  aliases: string[] | undefined;
  onChange: (aliases: string[]) => void;
  placeholder: string;
  /** Helper copy under the textarea — a plain sentence or a richer fragment. */
  helperText: ReactNode;
}

export function CatalogAliasesField({
  id,
  aliases,
  onChange,
  placeholder,
  helperText,
}: CatalogAliasesFieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Aliases</Label>
      <Textarea
        id={id}
        value={formatAliasesInput(aliases ?? [])}
        onChange={(e) => onChange(parseAliasesInput(e.target.value))}
        placeholder={placeholder}
        rows={5}
        className="font-mono text-xs"
      />
      <p className="text-xs text-muted-foreground">{helperText}</p>
    </div>
  );
}
