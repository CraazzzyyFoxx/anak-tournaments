"use client";

import { ConfirmDialog } from "@/components/admin/kit/ConfirmDialog";

interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  /** Noun phrase naming the object, e.g. "Delete stage". Required — a generic
   *  "Are you sure?" tells the reader nothing about what is about to happen. */
  title: string;
  description?: string;
  /** Records removed alongside the object; listed under the description. */
  cascadeInfo?: string[];
  /** Action button label. Override for confirmations that are not deletions. */
  confirmLabel?: string;
  /** Action button label while `isDeleting` is true. */
  confirmingLabel?: string;
  /** `"default"` drops the destructive red, for a non-destructive confirmation. */
  confirmVariant?: "default" | "destructive";
  isDeleting?: boolean;
}

/**
 * Thin wrapper over `kit/ConfirmDialog`, kept while the existing ~15 call
 * sites migrate one screen at a time. Deleted in P6 once none are left.
 */
export function DeleteConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
  description = "The record and its linked data are removed permanently. This cannot be undone.",
  cascadeInfo,
  confirmLabel = "Delete",
  confirmingLabel = "Deleting…",
  confirmVariant = "destructive",
  isDeleting = false
}: Readonly<DeleteConfirmDialogProps>) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
      pending={isDeleting}
      intent={{
        title,
        description,
        cascade: cascadeInfo,
        // `intent` carries the label, so the in-flight wording is swapped here
        // rather than adding a second label prop to the kit component.
        confirmLabel: isDeleting ? confirmingLabel : confirmLabel,
        tone: confirmVariant === "destructive" ? "danger" : "warning"
      }}
    />
  );
}
