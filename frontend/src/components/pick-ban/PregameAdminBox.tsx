import type { ElementType, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The organizer-only frame of the pre-game room. The amber dashed edge marks
 * everything inside as an override a captain never sees.
 */
export function PregameAdminBox({
  icon: Icon,
  title,
  aside,
  className,
  children
}: Readonly<{
  icon?: ElementType;
  title?: ReactNode;
  /** Trailing control in the head row (e.g. the map/hero switch). */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}>) {
  return (
    <section
      className={cn(
        "rounded-xl border border-dashed border-[color:var(--aqt-amber)]/45 bg-[color:var(--aqt-card-2)]/40 p-4",
        className
      )}
    >
      {title != null ? (
        <div className="mb-3 flex items-center gap-2">
          {Icon ? <Icon className="h-4 w-4 text-[color:var(--aqt-amber)]" aria-hidden /> : null}
          <h2 className="text-sm font-semibold">{title}</h2>
          {aside != null ? <div className="ml-auto">{aside}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
