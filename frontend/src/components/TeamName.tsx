
import { cn } from "@/lib/utils";

/**
 * Minimal team-like shape accepted by `TeamName`. Compatible with `Team`,
 * `TeamWithStats`, `Encounter["home_team"]` and the admin team reads.
 */
export interface TeamNameInput {
  name: string;
  image_url?: string | null;
}

type TeamNameSize = "xs" | "sm" | "md" | "lg" | "xl";

const LOGO_PX: Record<TeamNameSize, number> = { xs: 16, sm: 20, md: 28, lg: 40, xl: 52 };
const GAP_CLASS: Record<TeamNameSize, string> = {
  xs: "gap-1.5",
  sm: "gap-2",
  md: "gap-2",
  lg: "gap-2.5",
  xl: "gap-3"
};

interface TeamLogoProps {
  team?: TeamNameInput | null;
  size?: TeamNameSize;
  className?: string;
  /**
   * Accessible name. Empty by default because the logo is normally rendered next
   * to the team name (`TeamName`), where repeating it is noise for a screen
   * reader. Pass the team name when the logo stands alone.
   */
  alt?: string;
}

/**
 * The team's uploaded image, or nothing.
 *
 * There is deliberately no initials/colour-glyph fallback: a team without an
 * image shows no image anywhere on the site, so every surface stays consistent
 * whether or not the roster uploaded one.
 *
 * Plain `<img>` (not `next/image`) for the same reason workspace icons use one:
 * the URL points at whatever S3/MinIO host the deployment configured, and
 * `next/image` rejects a hostname missing from `next.config.mjs` remotePatterns
 * with a hard error instead of degrading.
 */
export const TeamLogo = ({ team, size = "sm", className, alt = "" }: TeamLogoProps) => {
  if (!team?.image_url) return null;
  const px = LOGO_PX[size];

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={team.image_url}
      alt={alt}
      aria-hidden={alt === "" ? true : undefined}
      width={px}
      height={px}
      loading="lazy"
      decoding="async"
      className={cn(
        "shrink-0 rounded-md border border-[color:var(--aqt-border)] object-cover",
        className
      )}
      style={{ width: px, height: px }}
    />
  );
};

interface TeamNameProps {
  team?: TeamNameInput | null;
  /** Rendered when there is no team yet (unseeded bracket slot, TBD side). */
  fallback?: string;
  size?: TeamNameSize;
  /** Mirror the row so an away side reads inward, logo on the trailing edge. */
  reverse?: boolean;
  className?: string;
  /** Extra classes on the name itself (colour, weight, size). */
  nameClassName?: string;
}

/**
 * The single way to render a team's identity: its image when it has one, then
 * its name, truncated with the full value in `title`.
 */
const TeamName = ({
  team,
  fallback = "—",
  size = "sm",
  reverse = false,
  className,
  nameClassName
}: TeamNameProps) => {
  const name = team?.name ?? fallback;

  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center",
        GAP_CLASS[size],
        reverse && "flex-row-reverse",
        className
      )}
    >
      <TeamLogo team={team} size={size} />
      <span className={cn("min-w-0 truncate", nameClassName)} title={name}>
        {name}
      </span>
    </span>
  );
};

export default TeamName;
