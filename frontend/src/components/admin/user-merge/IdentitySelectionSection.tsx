"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";

import type { UserMergeIdentityOption } from "@/types/admin.types";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { SocialIcon } from "@/components/social/SocialIcon";
import { getSocialProviderConfig } from "@/lib/social/providers";
import { EmptyNote } from "@/components/kit/EmptyNote";

export function IdentitySelectionSection({
  label,
  items,
  selectedIds,
  onToggle
}: Readonly<{
  label: string;
  items: UserMergeIdentityOption[];
  selectedIds: number[];
  onToggle: (identityId: number, checked: boolean) => void;
}>) {
  const t = useTranslations("adminPeople.merge");
  const groupId = useId();

  if (items.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium">{label}</p>
        <EmptyNote>
          {t("noSocial")}
        </EmptyNote>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium" id={groupId}>
        {label}
      </p>
      <div className="space-y-2" role="group" aria-labelledby={groupId}>
        {items.map((item) => {
          const checked = selectedIds.includes(item.id);
          const providerLabel = getSocialProviderConfig(item.provider).label;
          return (
            <div
              key={item.id}
              className="flex items-start gap-3 rounded-md border px-3 py-2"
            >
              <Checkbox
                checked={checked}
                onCheckedChange={(state) => onToggle(item.id, state === true)}
                className="mt-0.5"
                aria-label={t("move", { provider: providerLabel, value: item.value })}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <SocialIcon provider={item.provider} size={14} />
                  <span className="truncate text-sm font-medium">{item.value}</span>
                  <span className="text-xs text-muted-foreground">{providerLabel}</span>
                  {item.duplicate_on_target ? (
                    <Badge variant="outline" className="text-xs">
                      {t("duplicate")}
                    </Badge>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
