import type { ComponentProps } from "react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function SurfaceCard({ className, ...props }: ComponentProps<typeof Card>) {
  return (
    <Card
      data-ui="card"
      className={cn("rounded-2xl border-border/50 bg-card/70 shadow-sm", className)}
      {...props}
    />
  );
}

/**
 * Card header at the dashboard's shared padding. The `p-5 pb-3` / `px-5 pb-5`
 * pair used to be retyped in every dashboard card header and body; it lives
 * here now so the four cards cannot drift apart.
 */
export function SurfaceCardHeader({ className, ...props }: ComponentProps<typeof CardHeader>) {
  return <CardHeader className={cn("p-5 pb-3", className)} {...props} />;
}

/** Card body at the dashboard's shared padding. Add `pt-5` when there is no header. */
export function SurfaceCardContent({ className, ...props }: ComponentProps<typeof CardContent>) {
  return <CardContent className={cn("px-5 pb-5", className)} {...props} />;
}
