"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** One brand colour: a native picker and the hex it writes, kept in step.
 * Shared by the Branding section and the workspace wizard. */
export function BrandColorField({
  id,
  label,
  value,
  onChange
}: Readonly<{
  id: string;
  label: string;
  value: string | null | undefined;
  onChange: (value: string) => void;
}>) {
  const hex = value ?? "";
  const valid = /^#[0-9a-fA-F]{6}$/.test(hex);
  // Both hexes below are exempt from the design-token rule: `<input type="color">`
  // only accepts a literal `#rrggbb` (it cannot resolve a CSS variable), and the
  // text field's placeholder just shows that expected shape. Neither paints
  // chrome — the value they carry is the workspace's own persisted brand colour.
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="color"
          aria-label={label}
          value={valid ? hex : "#000000"}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-10 shrink-0 cursor-pointer rounded border border-input bg-transparent p-0.5"
        />
        <Input
          id={id}
          value={hex}
          onChange={(event) => onChange(event.target.value)}
          placeholder="#000000"
          className="font-mono"
        />
      </div>
    </div>
  );
}
