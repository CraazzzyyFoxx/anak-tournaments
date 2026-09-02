"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/admin/kit/ConfirmDialog";
import { useUnsavedGuard } from "@/components/admin/kit/useUnsavedGuard";

export interface SaveBarProps {
  dirty: boolean;
  /** What is about to be saved: "3 changed fields", "v4 draft · 9 divisions". */
  summary: ReactNode;
  onDiscard: () => void;
  onSave: () => void;
  saving?: boolean;
  primaryLabel?: string;
  secondary?: ReactNode;
}

/**
 * The save affordance for every T5 settings section.
 *
 * Sticky at the bottom and present only while dirty, so a clean form has no
 * dead "Save" button and a dirty one cannot be left behind by accident: it
 * shares `useUnsavedGuard` with `EntityFormDialog`, so navigating away goes
 * through the same discard prompt.
 */
export function SaveBar({
  dirty,
  summary,
  onDiscard,
  onSave,
  saving = false,
  primaryLabel = "Save changes",
  secondary
}: Readonly<SaveBarProps>) {
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  const handleNavigationBlocked = useCallback((href: string) => setPendingHref(href), []);

  useUnsavedGuard({
    dirty: dirty && !saving,
    onNavigationBlocked: handleNavigationBlocked
  });

  if (!dirty) return null;

  return (
    <>
      <div
        role="region"
        aria-label="Unsaved changes"
        className="sticky bottom-0 z-10 -mx-4 mt-4 flex flex-wrap items-center gap-3 border-t border-border bg-card/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/80"
      >
        <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{summary}</p>
        {secondary}
        <Button type="button" variant="outline" size="sm" onClick={onDiscard} disabled={saving}>
          Discard
        </Button>
        <Button type="button" size="sm" onClick={onSave} disabled={saving}>
          {saving ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : null}
          {primaryLabel}
        </Button>
      </div>

      <ConfirmDialog
        open={pendingHref !== null}
        onOpenChange={(open) => (open ? undefined : setPendingHref(null))}
        intent={{
          title: "Discard unsaved changes?",
          description:
            "You have unsaved changes on this page. Leave now and the current edits will be lost.",
          confirmLabel: "Discard changes",
          tone: "warning"
        }}
        onConfirm={() => {
          const href = pendingHref;
          setPendingHref(null);
          onDiscard();
          if (href) router.push(href);
        }}
      />
    </>
  );
}
