/**
 * Tone vocabulary for tinted status surfaces.
 *
 * Every chip, tile and row uses the same recipe —
 * `border-<tone>/40 bg-<tone>/10 text-<tone>` — against the semantic tokens
 * in `globals.css`. Index these maps instead of re-typing the class triple.
 */
export type Tone = "neutral" | "accent" | "success" | "warning" | "info" | "danger";

/** Tinted surface: border + low-alpha background + readable text. */
export const TONE_CLASS: Record<Tone, string> = {
  neutral: "border-border/60 bg-muted/10 text-muted-foreground",
  accent: "border-primary/40 bg-primary/10 text-primary",
  success: "border-success/40 bg-success/10 text-success",
  warning: "border-warning/40 bg-warning/10 text-warning",
  info: "border-info/40 bg-info/10 text-info",
  danger: "border-danger/40 bg-danger/10 text-danger"
};

/** Text-only tone, for icons and inline labels on an untinted surface. */
export const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-muted-foreground",
  accent: "text-primary",
  success: "text-success",
  warning: "text-warning",
  info: "text-info",
  danger: "text-danger"
};
