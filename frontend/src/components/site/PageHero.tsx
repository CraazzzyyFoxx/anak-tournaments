import React from "react";

import { cn } from "@/lib/utils";
import type { PlayerRoleTint } from "@/lib/player-role";

/**
 * Editorial-Tactical page hero (design-book / OWT artifact).
 *
 * The single restrained hero used across every `(site)` page. Replaces the
 * previous per-page multicolored banners (teal + rose/amber/blue glows + hex
 * lattice) with one calm treatment: a 2px teal top hairline, a faint masked
 * square grid, ONE low-opacity teal glow, and a mixed-case Onest title whose
 * accent word (wrapped in `<em>`) is painted with the role-spectrum gradient.
 *
 * Server-safe: presentational only, no hooks — usable from RSC and client
 * components alike. Colours come from the global `--aqt-*` tokens.
 */

/** Role hue for the profile wash — maps to the `--aqt-{role}` role tokens.
 *  This is a PLAYER-role tint (Tank/Damage/Support/Flex), not a hero class; the
 *  name is historical, so it stays an alias over the one tint vocabulary. */
type HeroRoleTint = PlayerRoleTint;

/**
 * Height of the band a cover banner occupies, and the top padding the copy
 * takes to clear it. One number for both: the picture ends exactly where the
 * text begins, so no title can land on artwork.
 */
export const COVER_BAND_PX = 80;

interface HeroFrameProps {
  children: React.ReactNode;
  className?: string;
  /**
   * Accent treatment. `"default"` (used by every list/dashboard hero) keeps the
   * calm teal top hairline. `"profile"` is the player-page signature from the
   * design-book: the role-spectrum hairline moves to the BASE and a role-tinted
   * wash bleeds from the top-left — the one place the multi-hue spectrum reads
   * as identity rather than decoration.
   */
  variant?: "default" | "profile";
  /** Role hue for the `"profile"` wash. Omit to skip the tint. */
  roleTint?: HeroRoleTint;
  /**
   * Optional banner image behind the hero (a tournament cover). Sits UNDER the
   * grid and glow so the frame keeps its identity.
   *
   * The image is `COVER_BAND_PX` TALL, not full-bleed behind the copy. Two
   * reasons, both learnt from rendering it the other way:
   *
   * - Contrast stops depending on the upload. The copy sits on the frame's own
   *   `bg`, exactly as it does with no cover, instead of on a scrimmed photo
   *   whose luminance nobody controls.
   * - `object-cover` crops to the box it fills. A full-bleed image in a ~200px
   *   header showed the TOP of the crop in the band and hid the middle under
   *   the scrim — so the organizer's centred key art was the one part never
   *   visible. Cropping into the band itself puts the source's centre on screen.
   *
   * The band fades into `bg` over its lower half so there is no seam.
   */
  coverUrl?: string | null;
}

/** The decorative shell only — for heroes with bespoke inner content. */
export function HeroFrame({
  children,
  className,
  variant = "default",
  roleTint,
  coverUrl,
}: Readonly<HeroFrameProps>) {
  const isProfile = variant === "profile";
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-2xl border border-[color:var(--aqt-border)] bg-[color:var(--aqt-bg)]",
        className
      )}
    >
      {/* Accent hairline: teal at the top by default; role-spectrum at the base
          for the player profile (its signature treatment). `overflow-hidden`
          on the section clips the bar cleanly inside the rounded corners. */}
      {isProfile ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-0.5 opacity-90"
          style={{ background: "var(--aqt-spectrum)" }}
        />
      ) : (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-[2] h-0.5 bg-[color:var(--aqt-teal)]"
        />
      )}
      {/* faint square grid, radially masked so it fades out */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-45"
        style={{
          backgroundImage:
            "linear-gradient(var(--aqt-border) 1px, transparent 1px), linear-gradient(90deg, var(--aqt-border) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          WebkitMaskImage:
            "radial-gradient(120% 120% at 20% 0%, #000 35%, transparent 80%)",
          maskImage: "radial-gradient(120% 120% at 20% 0%, #000 35%, transparent 80%)",
        }}
      />
      {/* single restrained teal glow */}
      <span
        aria-hidden
        className="pointer-events-none absolute -left-[8%] -top-[30%] h-[150%] w-3/5"
        style={{ background: "var(--aqt-hero-glow)" }}
      />
      {/* profile-only role-tinted wash from the top-left corner */}
      {isProfile && roleTint ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(70% 120% at 12% -20%, color-mix(in srgb, var(--aqt-${roleTint}) 16%, transparent), transparent 55%)`,
          }}
        />
      ) : null}
      {/* Cover band, ABOVE the grid and glow: those layers are the frame's
          identity where the frame shows — the copy area, which is most of the
          header — but painted over the artwork they tinted its left third teal
          and laid a 48px lattice on it. The band stays under the accent
          hairline (z-2) and the content (z-1). */}
      {coverUrl ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0"
          style={{ height: COVER_BAND_PX }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={coverUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
          <span
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(to bottom, transparent 0%," +
                " color-mix(in srgb, var(--aqt-bg) 25%, transparent) 55%," +
                " var(--aqt-bg) 100%)",
            }}
          />
        </span>
      ) : null}
      <div className="relative z-[1]">{children}</div>
    </section>
  );
}

interface PageHeroProps {
  /** Mono coordinate line(s) above the title (use `HeroCoord`). */
  eyebrow?: React.ReactNode;
  /** Big mixed-case title. Wrap the accent word in `<em>` for the spectrum. */
  title: React.ReactNode;
  /** Optional supporting sentence under the title. */
  lede?: React.ReactNode;
  /** Optional pills/badges row directly under the title (status, format…). */
  meta?: React.ReactNode;
  /** Optional call-to-action buttons under the lede. */
  actions?: React.ReactNode;
  /** Optional right column — stat blocks, controls, a live-events panel. */
  aside?: React.ReactNode;
  /** Optional mono "stamp" row at the bottom of the left column. */
  stamp?: React.ReactNode;
  className?: string;
  titleClassName?: string;
  /** Vertical alignment of the two columns. */
  align?: "start" | "end" | "center";
  /** Banner image behind the hero — see `HeroFrameProps.coverUrl`. */
  coverUrl?: string | null;
  /**
   * Tight header for pages whose content starts right under it (a tournament's
   * section rail): half the padding, a ~2rem title, single-line rhythm. The
   * hero is then a header, not a landing block.
   */
  compact?: boolean;
}

export function PageHero({
  eyebrow,
  title,
  lede,
  meta,
  actions,
  aside,
  stamp,
  className,
  titleClassName,
  align = "end",
  coverUrl,
  compact = false,
}: Readonly<PageHeroProps>) {
  return (
    <HeroFrame className={className} coverUrl={coverUrl}>
      <div
        /* The copy starts below the banner's visible strip. Inline, because the
           same number drives the scrim's ramp — a Tailwind class here would let
           the two drift apart silently. */
        style={coverUrl ? { paddingTop: COVER_BAND_PX } : undefined}
        className={cn(
          "grid",
          compact ? "gap-4 px-5 py-3.5 md:px-6 md:py-4" : "gap-8 px-6 py-8 md:px-10 md:py-9",
          // A compact hero is a page HEADER: its right column holds the action
          // row (wireframes §2), so it takes only the width the buttons need
          // instead of a third of the header away from the title.
          aside && (compact ? "lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-8" : "lg:grid-cols-[1.5fr_1fr] lg:gap-12"),
          align === "end" && "lg:items-end",
          align === "center" && "lg:items-center",
          align === "start" && "lg:items-start"
        )}
      >
        <div className="min-w-0">
          {eyebrow ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">{eyebrow}</div>
          ) : null}
          <h1
            className={cn(
              "aqt-hero-title font-onest font-semibold leading-[1.03] tracking-[-0.01em] text-[color:var(--aqt-fg)]",
              compact
                ? "mt-2 text-[clamp(1.75rem,2.6vw,2.25rem)]"
                : "mt-4 text-[clamp(2rem,4.6vw,3.5rem)]",
              titleClassName
            )}
          >
            {title}
          </h1>
          {meta ? (
            <div className={cn("flex flex-wrap items-center gap-2", compact ? "mt-2.5" : "mt-4")}>
              {meta}
            </div>
          ) : null}
          {lede ? (
            <p
              className={cn(
                "max-w-[34rem] text-sm leading-relaxed text-[color:var(--aqt-fg-muted)]",
                compact ? "mt-2.5 max-w-[48rem]" : "mt-5"
              )}
            >
              {lede}
            </p>
          ) : null}
          {actions ? (
            /* `empty:hidden` because `actions` is often a fragment whose children
               each decide whether they render — an ended tournament with no links
               passes a truthy node that emits nothing, and the margin alone would
               leave a 24px hole under the lede. */
            <div
              className={cn(
                "flex flex-wrap items-center gap-2.5 empty:hidden",
                compact ? "mt-2.5" : "mt-6"
              )}
            >
              {actions}
            </div>
          ) : null}
          {stamp ? (
            <div className="mt-7 flex flex-wrap gap-x-8 gap-y-3">{stamp}</div>
          ) : null}
        </div>
        {aside ? <div className="min-w-0">{aside}</div> : null}
      </div>
    </HeroFrame>
  );
}

/** Mono uppercase coordinate label — the tactical thread of the hero. */
export function HeroCoord({
  children,
  className,
}: Readonly<{
  children: React.ReactNode;
  className?: string;
}>) {
  return (
    <span
      className={cn(
        "font-mono text-[12px] uppercase tracking-[0.14em] text-[color:var(--aqt-fg-faint)]",
        className
      )}
    >
      {children}
    </span>
  );
}

/** Mono stamp: a small uppercase label with a normal-case value beneath it. */
export function HeroStamp({
  label,
  value,
  valueClassName,
}: Readonly<{
  label: React.ReactNode;
  value: React.ReactNode;
  valueClassName?: string;
}>) {
  return (
    <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--aqt-fg-faint)]">
      {label}
      <b
        className={cn(
          "mt-1 block text-[15px] font-semibold normal-case tracking-normal tabular-nums text-[color:var(--aqt-fg)]",
          valueClassName
        )}
      >
        {value}
      </b>
    </span>
  );
}

/** KPI stat block for the hero's right column. */
export function HeroStat({
  label,
  value,
  sub,
  className,
}: Readonly<{
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  className?: string;
}>) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[color:var(--aqt-fg-faint)]">
        {label}
      </span>
      <span className="font-onest text-[clamp(1.7rem,2.2vw,2.15rem)] font-bold leading-none tabular-nums text-[color:var(--aqt-fg)]">
        {value}
      </span>
      {sub ? <span className="text-[11px] text-[color:var(--aqt-fg-dim)]">{sub}</span> : null}
    </div>
  );
}
