"use client";

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">{t("acceptLabel")}</Label>
            <p className="text-xs text-muted-foreground">{t("acceptHint")}</p>
          </div>
          <Switch checked={isOpen} onCheckedChange={onChangeOpen} />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">{t("autoApproveLabel")}</Label>
            <p className="text-xs text-muted-foreground">{t("autoApproveHint")}</p>
          </div>
          <Switch checked={autoApprove} onCheckedChange={onChangeAutoApprove} />
        </div>
      </CardContent>
    </Card>
  );
}
