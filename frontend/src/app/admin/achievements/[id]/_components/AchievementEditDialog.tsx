"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { Upload, X } from "lucide-react";

import { EntityFormDialog } from "@/components/kit/EntityFormDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ACHIEVEMENT_IMAGE_ACCEPT,
  ACHIEVEMENT_IMAGE_PREVIEW_CLASS,
  MAX_ACHIEVEMENT_IMAGE_BYTES
} from "@/lib/uploads";
import type {
  AchievementCategory,
  AchievementGrain,
  AchievementRuleUpdateInput,
  AchievementScope
} from "@/types/admin.types";

import { CATEGORIES, GRAINS, SCOPES } from "../../achievement-meta";

/** Metadata only — the condition tree has its own card on the page. */
export function AchievementEditDialog({
  open,
  onOpenChange,
  slug,
  formData,
  onFormDataChange,
  imagePreview,
  onPickImage,
  onClearImage,
  onSubmit,
  isSubmitting,
  isDirty,
  errorMessage
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  formData: AchievementRuleUpdateInput;
  onFormDataChange: (next: AchievementRuleUpdateInput) => void;
  imagePreview: string | null;
  onPickImage: (file: File) => void;
  onClearImage: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  isDirty: boolean;
  errorMessage?: string;
}>) {
  const t = useTranslations("adminAchievements");
  const imageInputRef = useRef<HTMLInputElement>(null);

  return (
    <EntityFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("detail.editTitle", { slug })}
      description={t("detail.updateMetadata")}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      isSubmitting={isSubmitting}
      submittingLabel={t("common.updating")}
      errorMessage={errorMessage}
      isDirty={isDirty}
    >
      <ScrollArea className="max-h-[60vh]">
        <div className="space-y-4 pr-4">
          <div className="space-y-2">
            <Label>{t("common.name")}</Label>
            <Input
              value={formData.name ?? ""}
              onChange={(e) => onFormDataChange({ ...formData, name: e.target.value })}
              required
            />
          </div>

          {/* Image upload */}
          <div className="space-y-2">
            <Label>{t("common.image")}</Label>
            <div className="flex items-center gap-4">
              {(imagePreview || formData.image_url) && (
                <img
                  src={imagePreview ?? formData.image_url ?? ""}
                  alt={t("detail.achievementAlt")}
                  className={ACHIEVEMENT_IMAGE_PREVIEW_CLASS}
                />
              )}
              <div className="flex flex-col gap-2">
                <input
                  ref={imageInputRef}
                  type="file"
                  accept={ACHIEVEMENT_IMAGE_ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > MAX_ACHIEVEMENT_IMAGE_BYTES) {
                      alert(t("detail.fileTooLarge"));
                      return;
                    }
                    onPickImage(file);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => imageInputRef.current?.click()}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  {formData.image_url || imagePreview ? t("detail.changeImage") : t("detail.uploadImage")}
                </Button>
                {(imagePreview || formData.image_url) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      onClearImage();
                      onFormDataChange({ ...formData, image_url: null });
                    }}
                  >
                    <X className="mr-2 h-4 w-4" />
                    {t("detail.remove")}
                  </Button>
                )}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t("common.descriptionRu")}</Label>
              <Textarea
                value={formData.description_ru ?? ""}
                onChange={(e) => onFormDataChange({ ...formData, description_ru: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>{t("common.descriptionEn")}</Label>
              <Textarea
                value={formData.description_en ?? ""}
                onChange={(e) => onFormDataChange({ ...formData, description_en: e.target.value })}
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>{t("common.category")}</Label>
              <Select
                value={formData.category ?? "overall"}
                onValueChange={(v) =>
                  onFormDataChange({ ...formData, category: v as AchievementCategory })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {t(`common.categoryValues.${c}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("common.scope")}</Label>
              <Select
                value={formData.scope ?? "global"}
                onValueChange={(v) => onFormDataChange({ ...formData, scope: v as AchievementScope })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCOPES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`common.scopeValues.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("common.grain")}</Label>
              <Select
                value={formData.grain ?? "user"}
                onValueChange={(v) => onFormDataChange({ ...formData, grain: v as AchievementGrain })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GRAINS.map((g) => (
                    <SelectItem key={g} value={g}>
                      {t(`common.grainValues.${g}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </ScrollArea>
    </EntityFormDialog>
  );
}
