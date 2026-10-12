"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, Circle, Lock, Minus } from "lucide-react";
import { StatusPill } from "@/components/kit/StatusPill";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EYEBROW_CLASS, type Tone } from "@/components/kit/tone";
import type { ChecklistItem, ChecklistPhase } from "@/components/admin/tournament-checklist";

const PHASE_KEYS: ChecklistPhase[] = ["setup", "registration", "formation", "bracket", "live", "finish"];

function ChecklistRow({ item, t }: Readonly<{ item: ChecklistItem; t: ReturnType<typeof useTranslations> }>) {
  const meta = { done: { label: t("states.done"), icon: CheckCircle2, tone: "accent" as Tone }, todo: { label: t("states.todo"), icon: Circle, tone: "neutral" as Tone }, warn: { label: t("states.warn"), icon: AlertTriangle, tone: "warning" as Tone }, skipped: { label: t("states.skipped"), icon: Minus, tone: "neutral" as Tone }, "no-access": { label: t("states.noAccess"), icon: Lock, tone: "neutral" as Tone } }[item.state];
  const Icon = meta.icon;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/50 py-2 last:border-b-0">
      <div className="min-w-0">
        {item.href && item.state !== "no-access" ? (
          <Link href={item.href} className="text-sm hover:underline">
            {item.label}
          </Link>
        ) : (
          <span className="text-sm">{item.label}</span>
        )}
        {item.detail ? (
          <p className="truncate text-xs tabular-nums text-muted-foreground">{item.detail}</p>
        ) : null}
      </div>
      <StatusPill tone={meta.tone} className="shrink-0">
        <Icon className="size-3" aria-hidden />
        {meta.label}
      </StatusPill>
    </div>
  );
}

/**
 * Living checklist of the Overview tab (§3, D22). Items come pre-computed
 * from `buildChecklist`; groups without applicable items are omitted.
 *
 * This is the tab's `<h2>` section — the hub previously rendered no heading
 * above `<h3>`, leaving these group titles as the document's first headings.
 */
export function LifecycleChecklist({
  items,
  isLoading
}: Readonly<{ items: ChecklistItem[]; isLoading: boolean }>) {
  const t = useTranslations("adminTournament.lifecycle");
  const groups = PHASE_KEYS
    .map((phase) => ({ phase, rows: items.filter((item) => item.phase === phase) }))
    .filter((group) => group.rows.length > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle asChild>
          <h2>{t("title")}</h2>
        </CardTitle>
        <CardDescription>
          {t("description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
          </div>
        ) : (
          <div className="grid gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
            {groups.map((group) => (
              <section key={group.phase}>
                <h3 className={EYEBROW_CLASS}>{t(`phases.${group.phase}`)}</h3>
                <div className="mt-1">
                  {group.rows.map((item) => (
                    <ChecklistRow key={item.key} item={item} t={t} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
