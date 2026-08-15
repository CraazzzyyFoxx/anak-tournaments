"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";

type HoverPrefetchLinkProps = Omit<ComponentProps<typeof Link>, "prefetch">;

/**
 * A `<Link>` that prefetches on intent (hover or keyboard focus) instead of on
 * viewport entry.
 *
 * Next's default prefetches every link the moment it scrolls into view. Every
 * route under `/tournaments/[id]` is `force-dynamic`, so each of those
 * prefetches is a full server render with nothing cached in front of it — and
 * the surfaces that carry the most links are exactly the ones that render them
 * all at once: the section rail alone is nine, the bracket adds a pair per
 * match card.
 *
 * That turned one page view into a dozen-plus renders of pages nobody asked
 * for. Measured in production on 2026-08-15: 126 visitors produced 34,520 SSR
 * requests in 23 minutes — `/privacy` was rendered 463 times, 12-19 times per
 * visitor. The frontend is a single Node process, so page latency went from
 * ~150 ms idle to a 7.2 s p90, concurrency piled up in Traefik's in-flight
 * pool, and the edge started answering everyone with 429.
 *
 * Deferring to hover/focus keeps the click instant for the one link a reader is
 * actually reaching for and costs nothing for the eight they are not. On touch,
 * where there is no hover, navigation falls back to a normal request — every
 * one of these routes has a `loading.tsx`, so that shows a skeleton, not a
 * stall.
 *
 * `prefetch={null}` (not `true`) once armed: that is Next's "default" mode,
 * which for a dynamic route fetches only down to the nearest loading boundary
 * rather than the whole page.
 */
export function HoverPrefetchLink({ onMouseEnter, onFocus, ...props }: HoverPrefetchLinkProps) {
  const [armed, setArmed] = useState(false);

  return (
    <Link
      {...props}
      prefetch={armed ? null : false}
      onMouseEnter={(event) => {
        setArmed(true);
        onMouseEnter?.(event);
      }}
      onFocus={(event) => {
        setArmed(true);
        onFocus?.(event);
      }}
    />
  );
}

export default HoverPrefetchLink;
