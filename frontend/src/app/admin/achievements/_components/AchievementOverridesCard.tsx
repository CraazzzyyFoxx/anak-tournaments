"use client";

import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AchievementOverrideRead, AchievementRule } from "@/types/admin.types";

/**
 * Every manual grant and revoke in the workspace. Rule ids are resolved to
 * slugs through the catalog when it has loaded, and fall back to the raw id
 * rather than rendering a blank cell.
 */
export function AchievementOverridesCard({
  overrides,
  rules,
  onDelete,
  isDeleting,
}: Readonly<{
  overrides: AchievementOverrideRead[];
  rules?: AchievementRule[];
  onDelete: (id: number) => void;
  isDeleting: boolean;
}>) {
  const t = useTranslations("adminAchievements");
  return (
    <Card>
      <CardHeader>
        <CardTitle asChild>
          <h2>{t("overrides.title")}</h2>
        </CardTitle>
        <CardDescription>
          {t("overrides.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("common.achievement")}</TableHead>
              <TableHead>{t("common.user")}</TableHead>
              <TableHead>{t("common.action")}</TableHead>
              <TableHead>{t("common.reason")}</TableHead>
              <TableHead>{t("common.tournament")}</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {overrides.map((ov) => (
              <TableRow key={ov.id}>
                <TableCell>
                  {rules?.find((r) => r.id === ov.achievement_rule_id)?.slug ?? ov.achievement_rule_id}
                </TableCell>
                <TableCell className="tabular-nums">#{ov.user_id}</TableCell>
                <TableCell>
                  <Badge variant={ov.action === "grant" ? "success" : "destructive"}>
                    {ov.action}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-48 truncate">{ov.reason}</TableCell>
                <TableCell className="tabular-nums">{ov.tournament_id ?? "—"}</TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onDelete(ov.id)}
                    disabled={isDeleting}
                    aria-label={t("overrides.removeLabel", {
                      action: ov.action,
                      achievement: rules?.find((r) => r.id === ov.achievement_rule_id)?.name ?? `#${ov.achievement_rule_id}`,
                      userId: ov.user_id,
                    })}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" aria-hidden />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
