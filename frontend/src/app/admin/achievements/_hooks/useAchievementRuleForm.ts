"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import adminService from "@/services/admin.service";
import { achievementQueryKeys } from "@/lib/achievements/query-keys";
import { hasUnsavedChanges } from "@/lib/form-change";
import { MAX_ACHIEVEMENT_IMAGE_BYTES } from "@/lib/uploads";
import type {
  AchievementRule,
  AchievementRuleCreateInput,
  AchievementRuleUpdateInput,
} from "@/types/admin.types";

import {
  achievementFormDataWithSlug,
  emptyAchievementForm,
} from "../achievement-form.model";

/** What the create/edit dialog needs from the hook driving it. */
export interface AchievementRuleForm {
  open: boolean;
  editingRule: AchievementRule | null;
  /**
   * The game the open form belongs to: the rule's own when editing (immutable),
   * the draft's when creating. `null` while the dialog is closed.
   */
  discipline: string | null;
  formData: AchievementRuleCreateInput | AchievementRuleUpdateInput;
  setFormData: (data: AchievementRuleCreateInput | AchievementRuleUpdateInput) => void;
  imagePreview: string | null;
  imageError: string | null;
  imageInputRef: React.RefObject<HTMLInputElement | null>;
  isDirty: boolean;
  isSubmitting: boolean;
  /** Message of the failed create or update, whichever the dialog is running. */
  error?: string;
  openCreate: () => void;
  openEdit: (rule: AchievementRule) => void;
  /** Closes the dialog and drops the draft, image included. */
  reset: () => void;
  pickImage: (file: File) => void;
  clearImage: () => void;
  submit: (event: React.FormEvent) => void;
}

/**
 * The create/edit dialog's state and the two mutations behind it, for the list
 * and for a rule's own page. Saving with an image is two round-trips — the
 * rule has to exist before its badge can be uploaded against its slug — so the
 * upload lives inside each mutation rather than in a second call site.
 *
 * `selectedDiscipline` is where a new rule starts. A form already open keeps the
 * game it was opened for: a create draft is tied to its own `discipline` and an
 * edit to the rule's immutable one, so changing the page's game neither
 * reassigns an edit nor re-targets a half-written draft — closing it goes
 * through the dialog's own unsaved-changes prompt.
 */
export function useAchievementRuleForm(
  workspaceId: number | null,
  selectedDiscipline: string | null
): AchievementRuleForm {
  const t = useTranslations("adminAchievements");
  const queryClient = useQueryClient();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AchievementRule | null>(null);
  const [formData, setFormData] = useState<AchievementRuleCreateInput | AchievementRuleUpdateInput>(() =>
    emptyAchievementForm(selectedDiscipline ?? "")
  );
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const invalidateRules = (discipline: string) => {
    queryClient.invalidateQueries({ queryKey: achievementQueryKeys.adminList(workspaceId, discipline) });
    queryClient.invalidateQueries({ queryKey: achievementQueryKeys.publicLists() });
  };

  const createMutation = useMutation({
    mutationFn: async (data: AchievementRuleCreateInput) => {
      const created = await adminService.createAchievementRule(workspaceId!, data);
      if (imageFile && created.slug) {
        const uploadResult = await adminService.uploadAchievementImage(created.slug, imageFile, workspaceId!);
        await adminService.updateAchievementRule(workspaceId!, created.id, {
          image_url: uploadResult.public_url,
        });
      }
      return created;
    },
    onSuccess: (created) => {
      invalidateRules(created.discipline);
      setCreateDialogOpen(false);
      setFormData(emptyAchievementForm(selectedDiscipline ?? created.discipline));
      setImageFile(null);
      setImagePreview(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: AchievementRuleUpdateInput }) => {
      const updated = await adminService.updateAchievementRule(workspaceId!, id, data);
      if (imageFile && updated.slug) {
        const uploadResult = await adminService.uploadAchievementImage(updated.slug, imageFile, workspaceId!);
        await adminService.updateAchievementRule(workspaceId!, id, { image_url: uploadResult.public_url });
      }
      return updated;
    },
    onSuccess: (updated) => {
      invalidateRules(updated.discipline);
      queryClient.invalidateQueries({ queryKey: achievementQueryKeys.rule(workspaceId, updated.id) });
      setEditingRule(null);
      setFormData(emptyAchievementForm(selectedDiscipline ?? updated.discipline));
      setImageFile(null);
      setImagePreview(null);
    },
  });

  const reset = () => {
    setCreateDialogOpen(false);
    setEditingRule(null);
    setFormData(emptyAchievementForm(selectedDiscipline ?? ""));
    setImageFile(null);
    setImagePreview(null);
    setImageError(null);
  };

  const openCreate = () => {
    if (!selectedDiscipline) return;
    createMutation.reset();
    updateMutation.reset();
    setFormData(emptyAchievementForm(selectedDiscipline));
    setCreateDialogOpen(true);
  };

  const openEdit = (rule: AchievementRule) => {
    updateMutation.reset();
    setEditingRule(rule);
    setFormData(achievementFormDataWithSlug(rule));
  };

  const pickImage = (file: File) => {
    if (file.size > MAX_ACHIEVEMENT_IMAGE_BYTES) {
      setImageError(t("form.imageTooLarge", { name: file.name, size: (file.size / 1024 / 1024).toFixed(1) }));
      return;
    }
    setImageError(null);
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
    setImageError(null);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingRule) {
      updateMutation.mutate({ id: editingRule.id, data: formData as AchievementRuleUpdateInput });
    } else {
      createMutation.mutate(formData as AchievementRuleCreateInput);
    }
  };

  const open = createDialogOpen || !!editingRule;
  const draftDiscipline = (formData as AchievementRuleCreateInput).discipline;
  const discipline = editingRule ? editingRule.discipline : createDialogOpen ? draftDiscipline : null;
  const formInitial = editingRule
    ? achievementFormDataWithSlug(editingRule)
    : emptyAchievementForm(draftDiscipline ?? "");

  return {
    open,
    editingRule,
    discipline,
    formData,
    setFormData,
    imagePreview,
    imageError,
    imageInputRef,
    isDirty: open && hasUnsavedChanges(formData, formInitial),
    isSubmitting: createMutation.isPending || updateMutation.isPending,
    error: (editingRule ? updateMutation.error : createMutation.error) instanceof Error
      ? (editingRule ? updateMutation.error : createMutation.error)?.message
      : undefined,
    openCreate,
    openEdit,
    reset,
    pickImage,
    clearImage,
    submit,
  };
}
