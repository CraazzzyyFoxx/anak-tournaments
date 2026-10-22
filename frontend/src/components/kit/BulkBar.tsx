"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export interface BulkBarProps {
  /** How many rows the actions will apply to. Zero renders nothing. */
  count: number;
  onClear: () => void;
  children: ReactNode;
}

/**
 * The bottom bar that appears while rows are selected (F4 ·3).
 *
 * Same visual register as `kit/SaveBar`: a bar that exists only while there is
 * something to act on, holding a summary on the left and the actions on the
 * right. It is `fixed` rather than `sticky` because `DataTable` renders
 * `bulkActions` inside its toolbar row — which is exactly where bulk actions
 * used to be mistaken for filters, and the reason they moved down here.
 */
export function BulkBar({ count, onClear, children }: Readonly<BulkBarProps>) {
  const t = useTranslations("kit.actions");
  if (count === 0) return null;

  return (
    <Card
      role="region"
      aria-label={t("bulkActions")}
      className="fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 flex-wrap items-center gap-3 bg-card/95 px-4 py-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/80"
    >
      <p className="text-sm text-muted-foreground">
        {t.rich("selectedSummary", {
          count,
          num: (chunks) => <span className="font-medium tabular-nums text-foreground">{chunks}</span>
        })}
      </p>
      {children}
      <Button type="button" variant="ghost" size="icon-sm" aria-label={t("clearSelection")} onClick={onClear}>
        <X aria-hidden />
      </Button>
    </Card>
  );
}
