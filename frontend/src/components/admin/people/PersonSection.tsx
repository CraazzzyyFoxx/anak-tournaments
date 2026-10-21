"use client";

import { useId, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * One block of a person-hub tab: a heading with an optional count or verdict,
 * the block's own actions on the right, then its content.
 *
 * Open, not framed (DESIGN.md §5): the hub body groups by whitespace and
 * hairlines, so a list or a matrix inside never sits in a box inside a box.
 * Every tab of the hub uses this one heading, which is what makes the tabs
 * read as one screen.
 */
export function PersonSection({
  title,
  summary,
  actions,
  children,
  className
}: Readonly<{
  title: string;
  /** A count or a verdict beside the title, in body case. */
  summary?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}>) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={cn("min-w-0 space-y-3", className)}>
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 id={headingId} className="text-ui font-semibold text-foreground">
          {title}
          {summary != null && summary !== false ? (
            <span className="ml-2 font-normal tabular-nums text-muted-foreground">{summary}</span>
          ) : null}
        </h2>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
