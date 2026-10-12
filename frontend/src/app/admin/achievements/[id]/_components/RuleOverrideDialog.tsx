"use client";

import { useTranslations } from "next-intl";
import { TournamentCombobox } from "@/components/admin/TournamentCombobox";
import { UserSearchCombobox } from "@/components/admin/UserSearchCombobox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Tournament } from "@/types/tournament.types";

/** The draft an admin is filling in, before it becomes an override on this rule. */
export interface RuleOverrideDraft {
  userId?: number;
  userName: string;
  action: "grant" | "revoke";
  reason: string;
  tournamentId?: number;
}

export function RuleOverrideDialog({
  open,
  onOpenChange,
  ruleName,
  tournaments,
  draft,
  onDraftChange,
  onSubmit,
  isSaving,
  saveError
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ruleName: string;
  tournaments: Tournament[];
  draft: RuleOverrideDraft;
  onDraftChange: (next: RuleOverrideDraft) => void;
  onSubmit: () => void;
  isSaving: boolean;
  saveError?: string;
}>) {
  const t = useTranslations("adminAchievements");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("detail.ruleOverrideTitle", { name: ruleName })}</DialogTitle>
          <DialogDescription>{t("detail.ruleOverrideDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("common.user")}</Label>
            <UserSearchCombobox
              value={draft.userId}
              selectedName={draft.userName}
              onSelect={(user) =>
                onDraftChange({ ...draft, userId: user?.id, userName: user?.name ?? "" })
              }
              allowClear
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t("common.action")}</Label>
              <Select
                value={draft.action}
                onValueChange={(v) => onDraftChange({ ...draft, action: v as "grant" | "revoke" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="grant">{t("common.grant")}</SelectItem>
                  <SelectItem value="revoke">{t("common.revoke")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("common.tournament")} ({t("common.optional")})</Label>
              <TournamentCombobox
                tournaments={tournaments}
                value={draft.tournamentId}
                onSelect={(t) => onDraftChange({ ...draft, tournamentId: t?.id })}
                placeholder={t("condition.none")}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t("common.reason")}</Label>
            <Textarea
              value={draft.reason}
              onChange={(e) => onDraftChange({ ...draft, reason: e.target.value })}
              placeholder={t("detail.whyOverride")}
              required
            />
          </div>
          {saveError && <p className="text-sm text-destructive">{saveError}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={onSubmit}
            disabled={!draft.userId || !draft.reason || isSaving}
          >
            {isSaving ? t("common.saving") : draft.action === "grant" ? t("common.grant") : t("common.revoke")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
