"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

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
  const isDestructive = confirmVariant === "destructive";

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle
              aria-hidden
              className={cn("h-5 w-5", isDestructive ? "text-destructive" : "text-warning")}
            />
            <AlertDialogTitle>{title}</AlertDialogTitle>
          </div>
          <AlertDialogDescription>{description}</AlertDialogDescription>
          {cascadeInfo && cascadeInfo.length > 0 && (
            <div className="mt-4 rounded-md border border-destructive/20 bg-destructive/10 p-3">
              <p className="mb-2 font-medium text-destructive">This also removes:</p>
              <ul className="list-inside list-disc space-y-1 text-sm">
                {cascadeInfo.map((info) => (
                  <li key={info}>{info}</li>
                ))}
              </ul>
            </div>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            disabled={isDeleting}
            className={cn(isDestructive && "bg-destructive hover:bg-destructive/90")}
          >
            {isDeleting ? confirmingLabel : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
