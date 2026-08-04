"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function RegistrationStatusCard({
  isOpen,
  autoApprove,
  onChangeOpen,
  onChangeAutoApprove,
}: {
  isOpen: boolean;
  autoApprove: boolean;
  onChangeOpen: (value: boolean) => void;
  onChangeAutoApprove: (value: boolean) => void;
}) {
  const t = useTranslations("registrationFormAdmin.status");
  const idPrefix = useId();
  return (
    <Card>
      <CardHeader>
        <CardTitle asChild><h2>{t("title")}</h2></CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
          <div className="space-y-0.5">
            <Label htmlFor={`${idPrefix}-accept`} className="text-sm font-medium">
              {t("acceptLabel")}
            </Label>
            <p className="max-w-prose text-xs text-muted-foreground">{t("acceptHint")}</p>
          </div>
          <Switch id={`${idPrefix}-accept`} checked={isOpen} onCheckedChange={onChangeOpen} />
        </div>
        <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
          <div className="space-y-0.5">
            <Label htmlFor={`${idPrefix}-auto-approve`} className="text-sm font-medium">
              {t("autoApproveLabel")}
            </Label>
            <p className="max-w-prose text-xs text-muted-foreground">{t("autoApproveHint")}</p>
          </div>
          <Switch
            id={`${idPrefix}-auto-approve`}
            checked={autoApprove}
            onCheckedChange={onChangeAutoApprove}
          />
        </div>
      </CardContent>
    </Card>
  );
}
