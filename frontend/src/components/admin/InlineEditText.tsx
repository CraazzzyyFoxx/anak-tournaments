"use client";

import { useState, type KeyboardEvent } from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface InlineEditTextProps {
  value: string;
  /**
   * Persists the trimmed draft. Pass a promise (e.g. `mutation.mutateAsync`) so the
   * editor stays open with the draft intact when saving fails.
   */
  onSave: (next: string) => void | Promise<unknown>;
  /** Accessible name of the field, e.g. "Group name". */
  label: string;
  canEdit?: boolean;
  className?: string;
  textClassName?: string;
  inputClassName?: string;
}

/** Read-only text with a pencil affordance that swaps in an input plus save/cancel. */
export function InlineEditText({
  value,
  onSave,
  label,
  canEdit = true,
  className,
  textClassName,
  inputClassName
}: InlineEditTextProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const commit = async () => {
    const next = draft?.trim() ?? "";
    if (!next || next === value) {
      setDraft(null);
      return;
    }
    setIsSaving(true);
    try {
      await onSave(next);
      setDraft(null);
    } catch {
      // Caller reports the failure; keep the draft so it can be retried.
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDraft(null);
    }
  };

  if (draft === null) {
    return (
      <div className={cn("flex min-w-0 items-center gap-1", className)}>
        <span className={cn("truncate", textClassName)}>{value}</span>
        {canEdit ? (
          <Button
            size="icon"
            variant="ghost"
            className="size-7 shrink-0 text-muted-foreground [&_svg]:size-3.5"
            aria-label={`Edit ${label}`}
            title={`Edit ${label}`}
            onClick={() => setDraft(value)}
          >
            <Pencil />
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className={cn("flex min-w-0 items-center gap-1", className)}>
      <Input
        autoFocus
        aria-label={label}
        value={draft}
        disabled={isSaving}
        className={cn("h-7", inputClassName)}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <Button
        size="icon"
        variant="ghost"
        className="size-7 shrink-0 [&_svg]:size-3.5"
        aria-label={`Save ${label}`}
        disabled={isSaving || !draft.trim()}
        onClick={() => void commit()}
      >
        {isSaving ? <Loader2 className="animate-spin" /> : <Check />}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-7 shrink-0 text-muted-foreground [&_svg]:size-3.5"
        aria-label={`Cancel ${label} edit`}
        disabled={isSaving}
        onClick={() => setDraft(null)}
      >
        <X />
      </Button>
    </div>
  );
}
