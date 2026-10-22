"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";

import type {
  UserMergeFieldChoice,
  UserMergeFieldPolicy,
  UserMergePreviewResponse
} from "@/types/admin.types";
import Image from "@/components/ui/image";
import { cn } from "@/lib/utils";

export type FieldKey = keyof UserMergeFieldPolicy;

export function FieldChoiceButtons({
  label,
  fieldKey,
  preview,
  value,
  sourceName,
  targetName,
  onChange
}: Readonly<{
  label: string;
  fieldKey: FieldKey;
  preview: UserMergePreviewResponse;
  value: UserMergeFieldChoice;
  sourceName: string;
  targetName: string;
  onChange: (value: UserMergeFieldChoice) => void;
}>) {
  const t = useTranslations("adminPeople.merge");
  const groupId = useId();
  const options = [
    ["source", sourceName, preview.field_options[fieldKey].source],
    ["target", targetName, preview.field_options[fieldKey].target]
  ] as const;

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium" id={groupId}>{label}</p>
      <div className="grid grid-cols-2 gap-2" role="group" aria-labelledby={groupId}>
        {options.map(([choice, caption, raw]) => {
          const selected = value === choice;
          const photo = fieldKey === "avatar_url" && raw && /^https?:\/\//.test(raw) ? raw : null;
          return (
            <button
              key={choice}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(choice)}
              className={cn(
                "rounded-md border px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected ? "border-foreground bg-foreground/5" : "border-border text-muted-foreground hover:bg-muted/40"
              )}
            >
              <span className="block truncate text-xs">{caption}</span>
              {photo ? (
                <Image src={photo} alt="" width={32} height={32} className="mt-1 h-8 w-8 rounded-full object-cover" />
              ) : (
                <span className={cn("mt-0.5 block truncate text-sm", selected && "text-foreground")}>
                  {raw || t("none")}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
