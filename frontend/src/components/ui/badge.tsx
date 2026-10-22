import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { TONE_CLASS, type Tone } from "@/components/ui/tone";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap border px-2 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: TONE_CLASS.neutral,
        destructive: TONE_CLASS.danger,
        outline: "border-border/60 bg-transparent text-foreground",
        accent: TONE_CLASS.accent,
        success: TONE_CLASS.success,
        warning: TONE_CLASS.warning,
        info: TONE_CLASS.info
      },
      shape: {
        badge: "rounded-md",
        pill: "rounded-full"
      },
      size: {
        default: "",
        /** The dense status chip of admin tables and registration rows. */
        sm: "px-1.5 text-label leading-none"
      },
      voice: {
        text: "",
        /** The uppercase data/label voice: lifecycle status, "League". */
        label:
          "gap-1.5 px-[9px] py-1 font-[family-name:var(--aqt-data)] text-label font-bold uppercase tracking-label"
      }
    },
    defaultVariants: {
      variant: "default",
      shape: "badge",
      size: "default",
      voice: "text"
    }
  }
);

const TONE_VARIANT = {
  neutral: "secondary",
  accent: "accent",
  success: "success",
  warning: "warning",
  info: "info",
  danger: "destructive"
} as const satisfies Record<Tone, NonNullable<VariantProps<typeof badgeVariants>["variant"]>>;

/**
 * The `--aqt-*` palette: one color-mix tint over `--badge-hue`. A `tone` sets the
 * hue; without one the caller sets `[--badge-hue:…]` itself (the lifecycle pill
 * reads `--aqt-status-*`, a hue no `Tone` names).
 */
const AQT_TINT =
  "border-[color:color-mix(in_srgb,var(--badge-hue)_22%,transparent)] bg-[color:color-mix(in_srgb,var(--badge-hue)_10%,transparent)] text-[color:var(--badge-hue)]";

const AQT_TONE: Record<Tone, string> = {
  neutral: "border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-overlay-3)] text-[color:var(--aqt-fg-muted)]",
  accent: `${AQT_TINT} [--badge-hue:var(--aqt-teal)]`,
  success: `${AQT_TINT} [--badge-hue:var(--aqt-emerald)]`,
  warning: `${AQT_TINT} [--badge-hue:var(--aqt-amber)]`,
  info: `${AQT_TINT} [--badge-hue:var(--aqt-blue)]`,
  danger: `${AQT_TINT} [--badge-hue:var(--aqt-rose)]`
};

interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Semantic tone; wins over `variant` when both are set. */
  tone?: Tone;
  /**
   * `semantic` (default) tints with the shadcn status tokens via `TONE_CLASS`;
   * `aqt` with the public site's `--aqt-*` hues. `variant` is ignored under `aqt`.
   */
  palette?: "semantic" | "aqt";
}

function Badge({ className, variant, shape, size, voice, tone, palette = "semantic", ...props }: BadgeProps) {
  const aqt = palette === "aqt";
  return (
    <span
      className={cn(
        badgeVariants({
          variant: aqt ? null : tone ? TONE_VARIANT[tone] : variant,
          shape,
          size,
          voice
        }),
        aqt && (tone ? AQT_TONE[tone] : AQT_TINT),
        className
      )}
      {...props}
    />
  );
}

export { Badge };
