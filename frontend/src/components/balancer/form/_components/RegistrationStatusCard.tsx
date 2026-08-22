"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * `isOpen` is READ-ONLY and derived.
 *
 * Registration openness is the tournament's REGISTRATION phase-schedule window —
 * one switch, on the tournament, driven by the stage. The form used to carry its
 * own `is_open` kill switch, so opening registration needed two separate acts in
 * two places; the toggle that used to live here would now write to a column
 * nothing reads, so it is a status line instead of a control.
 */
export function RegistrationStatusCard({
  isOpen,
  autoApprove,
  onChangeAutoApprove,
}: Readonly<{
  isOpen: boolean;
  autoApprove: boolean;
  onChangeAutoApprove: (value: boolean) => void;
}>) {
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
            <p className="text-sm font-medium">{t("acceptLabel")}</p>
            <p className="max-w-prose text-xs text-muted-foreground">{t("scheduleHint")}</p>
          </div>
          <span
            className={
              isOpen
                ? "shrink-0 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400"
                : "shrink-0 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground"
            }
          >
            {isOpen ? t("stateOpen") : t("stateClosed")}
          </span>
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
