"use client";

import * as React from "react";
import { AlertCircle, Inbox, SearchX, FileQuestion } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

export type PageStateKind = "error" | "empty" | "filtered-empty" | "not-found";

interface PageStateCardProps {
  state: PageStateKind;
  title?: string;
  description?: string;
  /** Shown for `error`; also used as "Clear filters" for `filtered-empty`. */
  onAction?: () => void;
  actionLabel?: string;
  className?: string;
}

const ICONS: Record<PageStateKind, React.ComponentType<{ className?: string }>> = {
  error: AlertCircle,
  empty: Inbox,
  "filtered-empty": SearchX,
  "not-found": FileQuestion
};

// Full literal keys, not `common.pageState.${state}` template strings: next-intl
// is configured with typed messages, and a template literal widens to `string`,
// which the typed `t()` rightly rejects.
const COPY: Record<PageStateKind, { title: string; description: string }> = {
  error: {
    title: "common.pageState.error.title",
    description: "common.pageState.error.description"
  },
  empty: {
    title: "common.pageState.empty.title",
    description: "common.pageState.empty.description"
  },
  "filtered-empty": {
    title: "common.pageState.filteredEmpty.title",
    description: "common.pageState.filteredEmpty.description"
  },
  "not-found": {
    title: "common.pageState.notFound.title",
    description: "common.pageState.notFound.description"
  }
};

/**
 * The single empty / error / not-found surface for the public site.
 *
 * Before this existed the site had four competing error designs and a dozen
 * bare-text fallbacks, and — worse — several routes had no error branch at all,
 * so a failed fetch was rendered to the user as "there is nothing here". Every
 * state here carries an explanation and, where recovery is possible, an action.
 */
export function PageStateCard({
  state,
  title,
  description,
  onAction,
  actionLabel,
  className
}: Readonly<PageStateCardProps>) {
  const t = useTranslations();
  const Icon = ICONS[state];

  const copy = COPY[state];
  const resolvedTitle = title ?? t(copy.title as never);
  const resolvedDescription = description ?? t(copy.description as never);
  const resolvedActionLabel =
    actionLabel ?? (state === "filtered-empty" ? t("common.clearFilters") : t("common.retry"));

  return (
    <section
      // `error` is the only state that reports a failure the user did not cause,
      // so it is the only one announced assertively.
      role={state === "error" ? "alert" : "status"}
      className={cn(
        "flex flex-col items-center gap-3 rounded-[var(--aqt-radius)] border border-[color:var(--aqt-border)] bg-[color:var(--aqt-card)] px-6 py-10 text-center",
        className
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          "size-6",
          state === "error" ? "text-[color:var(--aqt-rose)]" : "text-[color:var(--aqt-fg-faint)]"
        )}
      />
      <div className="space-y-1">
        <p className="text-sm font-semibold text-[color:var(--aqt-fg)]">{resolvedTitle}</p>
        <p className="mx-auto max-w-prose text-caption leading-relaxed text-[color:var(--aqt-fg-muted)]">
          {resolvedDescription}
        </p>
      </div>
      {onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="mt-1 inline-flex h-9 items-center rounded-lg border border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-overlay-2)] px-4 text-caption font-medium text-[color:var(--aqt-fg)] outline-none transition-colors hover:bg-[color:var(--aqt-overlay-3)] focus-visible:ring-2 focus-visible:ring-[color:var(--aqt-teal)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--aqt-card)]"
        >
          {resolvedActionLabel}
        </button>
      ) : null}
    </section>
  );
}
