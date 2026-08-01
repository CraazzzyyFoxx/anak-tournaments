import { cn } from "@/lib/utils";

const SHAPE_CLASS = {
  square: "rounded-md",
  circle: "rounded-full"
} as const;

interface AssetPreviewProps {
  imagePath?: string | null;
  /** Entity name — seeds the initial-letter fallback and the accessible name. */
  name: string;
  /** What the image is, used in the accessible name: "map image", "hero icon". */
  assetLabel: string;
  shape?: keyof typeof SHAPE_CLASS;
  className?: string;
}

/**
 * Thumbnail for a catalogue entry: the asset itself when there is a path, an
 * initial-letter placeholder otherwise. Both branches are exposed as an image
 * with a real accessible name, so the table never presents an unlabelled box.
 */
export function AssetPreview({
  imagePath,
  name,
  assetLabel,
  shape = "square",
  className
}: AssetPreviewProps) {
  const trimmed = name.trim();
  const accessibleName = trimmed ? `${trimmed} ${assetLabel}` : assetLabel;

  if (!imagePath) {
    return (
      <div
        role="img"
        aria-label={`${accessibleName} placeholder`}
        className={cn(
          "flex items-center justify-center border border-dashed border-border/70 bg-muted/30 text-sm font-semibold text-muted-foreground",
          SHAPE_CLASS[shape],
          className
        )}
      >
        {(trimmed.charAt(0) || "?").toUpperCase()}
      </div>
    );
  }

  return (
    <div
      role="img"
      aria-label={accessibleName}
      className={cn(
        "border border-border/70 bg-muted/20 bg-cover bg-center",
        SHAPE_CLASS[shape],
        className
      )}
      style={{ backgroundImage: `url("${imagePath}")` }}
    />
  );
}
