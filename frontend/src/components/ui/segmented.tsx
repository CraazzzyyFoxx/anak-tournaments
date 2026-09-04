"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { segmentedFrame, toggleVariants } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";

export type SegmentedLinkItem = {
  key: string;
  href: string;
  /** Text, or an icon — pass `ariaLabel` alongside an icon. */
  label: ReactNode;
  isActive: boolean;
  /** Accessible name when `label` is an icon. */
  ariaLabel?: string;
};

export type SegmentedLinksProps = {
  items: readonly SegmentedLinkItem[];
  label: string;
  className?: string;
};

/**
 * The site's segmented control in its navigation form: the same drawing as
 * `ToggleGroup variant="pill"`, but each segment is a real link, so a stage
 * switch is a shareable URL and opens in a new tab like any other link.
 *
 * It borrows `segmentedFrame` and `toggleVariants` rather than restating them,
 * which is what the old `.stage-tabs` CSS did — and drifted from.
 */
export function SegmentedLinks({ items, label, className }: Readonly<SegmentedLinksProps>) {
  return (
    <nav aria-label={label} className={cn(segmentedFrame, className)}>
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.isActive ? "page" : undefined}
          data-state={item.isActive ? "on" : "off"}
          className={cn(toggleVariants({ variant: "pill", size: "sm" }), "no-underline")}
        >
          {item.ariaLabel ? <span className="sr-only">{item.ariaLabel}</span> : null}
          <span aria-hidden={item.ariaLabel ? true : undefined}>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
