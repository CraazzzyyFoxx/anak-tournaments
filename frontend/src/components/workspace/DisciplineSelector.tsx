"use client";

import { useTranslations } from "next-intl";

import { PageStateCard } from "@/components/ui/page-state-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { ALL_DISCIPLINES, type ResolvedDiscipline } from "@/lib/site/discipline-scope";
import type { DisciplineDescriptor } from "@/types/discipline.types";

/**
 * The browsing-game control. Concrete choices show the game's own name; `all` is a
 * separate directory option offered only where the surface allows it. Only enabled
 * games are choices — a disabled one is history, not a selection. Hidden when there is
 * nothing to choose between, except while the current value is not a valid choice (an
 * invalid URL), where it is the way out.
 */
export function DisciplineSelector({
  disciplines,
  value,
  allowsAll,
  onSelect,
  disabled,
  className
}: Readonly<{
  disciplines: readonly DisciplineDescriptor[];
  /** The resolved choice (`all` or a code); `undefined` when nothing valid is selected. */
  value: string | undefined;
  allowsAll: boolean;
  onSelect: (value: string) => void;
  disabled?: boolean;
  className?: string;
}>) {
  const t = useTranslations("common.discipline");
  const choices = disciplines.filter((discipline) => discipline.enabled);
  if (value !== undefined && choices.length + (allowsAll ? 1 : 0) < 2) return null;

  return (
    <Select value={value} onValueChange={onSelect} disabled={disabled}>
      <SelectTrigger className={className ?? "w-52"} aria-label={t("select")}>
        <SelectValue placeholder={t("select")} />
      </SelectTrigger>
      <SelectContent>
        {allowsAll ? <SelectItem value={ALL_DISCIPLINES}>{t("all")}</SelectItem> : null}
        {choices.map((discipline) => (
          <SelectItem key={discipline.code} value={discipline.code}>
            {discipline.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * What a surface shows instead of game data when the resolution is `invalid` (the
 * requested value is named, never corrected) or `empty` (nothing enabled). It
 * issues no game request; the invalid case carries the selector as its action.
 */
export function DisciplineUnavailable({
  resolved,
  disciplines,
  allowsAll,
  onSelect
}: Readonly<{
  resolved: Extract<ResolvedDiscipline, { kind: "invalid" | "empty" }>;
  disciplines: readonly DisciplineDescriptor[];
  allowsAll: boolean;
  onSelect: (value: string) => void;
}>) {
  const t = useTranslations("common.discipline");
  if (resolved.kind === "empty") {
    return <PageStateCard state="empty" title={t("emptyTitle")} description={t("empty")} />;
  }
  return (
    <div className="space-y-3">
      <PageStateCard
        state="error"
        title={t("invalidTitle")}
        description={t(`invalid.${resolved.reason}`, { requested: resolved.requested })}
      />
      <div className="flex flex-col items-center gap-2">
        <p className="text-caption text-[color:var(--aqt-fg-muted)]">{t("invalidAction")}</p>
        <DisciplineSelector disciplines={disciplines} value={undefined} allowsAll={allowsAll} onSelect={onSelect} />
      </div>
    </div>
  );
}
