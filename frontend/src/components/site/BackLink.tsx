import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

import { eyebrowClass } from "@/components/ui/eyebrow";
import { cn } from "@/lib/utils";

/** "← Back to …": the eyebrow-voiced text link above a detail page's title. */
export function BackLink({
  href,
  children,
  className
}: Readonly<{ href: string; children: ReactNode; className?: string }>) {
  return (
    <Link
      href={href}
      className={cn(
        eyebrowClass(),
        "inline-flex items-center gap-1.5 transition-colors hover:text-[color:var(--aqt-teal)]",
        className
      )}
    >
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
      {children}
    </Link>
  );
}
