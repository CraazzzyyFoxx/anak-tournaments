"use client";

import { useTranslations } from "next-intl";
import { HoverPrefetchLink } from "@/components/HoverPrefetchLink";
import { AlertCircle, AlertTriangle, ChevronRight, Info, type LucideIcon } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TONE_TEXT, type Tone } from "@/components/kit/tone";
import { cn } from "@/lib/utils";

type AttentionTone = "critical" | "warning" | "info";

export type IssueItem = {
  label: string;
  count: number;
  href: string;
  tone: AttentionTone;
};

/**
 * How each severity reads. The icon shape is the redundant cue beside the
 * colour, and `detail` is the screen-reader text for it — the row used to
 * print "Needs attention soon" under every warning, three times in a column.
 */
const SEVERITY: Record<AttentionTone, { tone: Tone; icon: LucideIcon }> = {
  critical: { tone: "danger", icon: AlertTriangle },
  warning: { tone: "warning", icon: AlertCircle },
  info: { tone: "info", icon: Info }
};

function severityKey(tone: AttentionTone) {
  return tone === "critical"
    ? "needsImmediateAction"
    : tone === "warning"
      ? "needsAttentionSoon"
      : "reviewWhenConvenient";
}

interface IssuesQueueProps {
  items: IssueItem[];
}

export function IssuesQueue({ items }: Readonly<IssuesQueueProps>) {
  const t = useTranslations("adminShell.dashboard");

  return (
    <Card>
      <CardHeader>
        <CardTitle asChild>
          <h2>{t("issues")}</h2>
        </CardTitle>
        {items.length > 0 && (
          <CardDescription>
            {t("issueCount", { count: items.length })}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {items.length > 0 ? (
          <ul className="divide-y divide-border/50">
            {items.map((item) => {
              const severity = SEVERITY[item.tone];
              const Icon = severity.icon;
              return (
                <li key={item.label}>
                  {/* Bleeds to the card edge so the hover fill spans the card. */}
                  <HoverPrefetchLink
                    href={item.href}
                    className="-mx-6 flex items-center gap-3 px-6 py-2.5 transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <Icon className={cn("size-4 shrink-0", TONE_TEXT[severity.tone])} aria-hidden />
                    <span className="sr-only">{t(severityKey(item.tone))}: </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {item.label}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-sm font-semibold tabular-nums",
                        TONE_TEXT[severity.tone]
                      )}
                    >
                      {item.count}
                    </span>
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  </HoverPrefetchLink>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("nothingNeedsAttention")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
