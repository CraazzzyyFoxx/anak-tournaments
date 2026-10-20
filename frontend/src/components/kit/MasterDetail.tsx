"use client";

import type { CSSProperties, ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface MasterDetailProps {
  list: ReactNode;
  /**
   * The editor for the selected row, or `null`/`undefined` when nothing is
   * selected — which is also what switches the narrow layout back to the list.
   */
  detail: ReactNode;
  listWidth?: number;
  emptyDetail?: ReactNode;
}

/**
 * The T4 layout: a list on the left, an editor on the right.
 *
 * Replaces the "one screen, seven dialogs" shape of `StageManager` and the
 * pre-game scope selector: selecting is navigation, editing is a panel, and
 * neither is a modal.
 *
 * Below `md` there is no room for both, so it shows one at a time. The
 * caller MUST write its selection with `mode: "push"` — the Back button steps
 * the history entry back, which is the only way to return to the list without
 * this component knowing the caller's query-param name.
 */
export function MasterDetail({
  list,
  detail,
  listWidth = 280,
  emptyDetail
}: Readonly<MasterDetailProps>) {
  const t = useTranslations("kit.actions");
  const hasSelection = detail !== null && detail !== undefined && detail !== false;

  return (
    <div
      className="grid gap-4 md:[grid-template-columns:var(--admin-master-width)_minmax(0,1fr)]"
      style={{ "--admin-master-width": `${listWidth}px` } as CSSProperties}
    >
      <div className={hasSelection ? "hidden md:block" : "block"}>{list}</div>
      <div className={hasSelection ? "block min-w-0" : "hidden min-w-0 md:block"}>
        {hasSelection ? (
          <>
            <div className="mb-3 md:hidden">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => window.history.back()}
              >
                <ChevronLeft aria-hidden className="size-4" />
        {t("backToList")}
              </Button>
            </div>
            {detail}
          </>
        ) : (
          emptyDetail
        )}
      </div>
    </div>
  );
}

export interface MasterListItem<K extends string | number> {
  key: K;
  label: string;
  /** Decorative mark before the label, e.g. a role icon. */
  icon?: ReactNode;
}

/**
 * The plain T4 list column: one frame of named rows, the selected one marked
 * with `aria-current`. Selecting is navigation, so `onSelect` writes the
 * caller's query param (with `mode: "push"`, see `MasterDetail`). Lists with a
 * toolbar of their own (search, per-row actions) keep their own component.
 */
export function MasterList<K extends string | number>({
  label,
  items,
  selectedKey,
  onSelect
}: Readonly<{
  /** Accessible name of the `<nav>`. */
  label: string;
  items: readonly MasterListItem<K>[];
  selectedKey: K | null | undefined;
  onSelect: (key: K) => void;
}>) {
  return (
    <nav aria-label={label} className="rounded-xl border border-border bg-card p-2">
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => {
          const isSelected = item.key === selectedKey;
          return (
            <li key={item.key}>
              <button
                type="button"
                aria-current={isSelected ? "true" : undefined}
                onClick={() => onSelect(item.key)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isSelected
                    ? "bg-accent/40 font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {item.icon}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** `MasterList` while its rows load: the same frame with placeholder rows. */
export function MasterListSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-0.5 rounded-xl border border-border bg-card p-2">
      {[0, 1, 2, 3].map((row) => (
        <Skeleton key={row} className="h-8 w-full rounded-md" />
      ))}
    </div>
  );
}
