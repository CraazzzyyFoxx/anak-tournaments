"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { getDefaultStageItemType, STAGE_ITEM_TYPE_LABELS } from "@/lib/bracket/projection";
import adminService from "@/services/admin.service";
import type { Stage, StageItemType } from "@/types/tournament.types";

/** The row under the stage's items that appends one more group or bracket lane. */
export function AddStageItemForm({
  stage,
  onChanged
}: Readonly<{ stage: Stage; onChanged: () => void }>) {
  const t = useTranslations("adminBracket.items");
  const tRoot = useTranslations("adminBracket");
  const [draftName, setDraftName] = useState("");
  const [draftType, setDraftType] = useState<StageItemType>(
    getDefaultStageItemType(stage.stage_type)
  );
  const nextItemName =
    draftType === "group" ? t("group", { number: stage.items.length + 1 }) : t("bracket");

  const createItemMutation = useMutation({
    mutationFn: () =>
      adminService.createStageItem(stage.id, {
        name: draftName.trim() || nextItemName,
        type: draftType,
        order: stage.items.length
      }),
    onSuccess: () => {
      setDraftName("");
      onChanged();
    }
  });

  return (
    <div className="grid gap-2 border-t border-border pt-3 lg:grid-cols-[minmax(0,1fr)_200px_auto] lg:items-end">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="stage-item-name" className="text-xs">
          {t("itemName")}
        </Label>
        <Input
          id="stage-item-name"
          className="h-9"
          placeholder={nextItemName}
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="stage-item-type" className="text-xs">
          {t("typeLabel")}
        </Label>
        <Select value={draftType} onValueChange={(value) => setDraftType(value as StageItemType)}>
          <SelectTrigger id="stage-item-type" className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(STAGE_ITEM_TYPE_LABELS).map(([value]) => (
              <SelectItem key={value} value={value}>
                {tRoot(`labels.itemTypes.${value}` as never)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button
        size="sm"
        variant="secondary"
        disabled={createItemMutation.isPending}
        onClick={() => createItemMutation.mutate()}
      >
        {createItemMutation.isPending ? (
          <Spinner />
        ) : (
          <Plus className="size-4" aria-hidden />
        )}
        {createItemMutation.isPending ? t("adding") : t("addStructure")}
      </Button>
    </div>
  );
}
