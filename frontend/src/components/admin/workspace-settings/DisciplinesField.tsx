"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { SortableGrip, SortableRows, useSortableRow } from "@/components/kit/SortableRows";
import { useDisciplines } from "@/hooks/useDisciplineMetadata";
import { cn } from "@/lib/utils";
import type { DisciplineDescriptor } from "@/types/discipline.types";

const ROW_CLASS =
  "flex items-center gap-3 rounded-xl border px-3 py-2 border-[color:var(--aqt-border)] bg-[color:var(--aqt-overlay-1)]";

/**
 * The workspace's games: the enabled ones in priority order, then the rest.
 *
 * Order is data, not cosmetics — `disciplines_enabled[0]` is the game a
 * tournament, grid or mix gets when none is named (`workspace_discipline`,
 * `useDivisionGrid`), and the server stores the list exactly as sent. So the
 * enabled rows are a drag list and nothing re-sorts them; turning a game on
 * appends it, turning it off removes it and the next one becomes default.
 *
 * The switch of the last enabled game is disabled rather than refused on save:
 * the server needs at least one (`normalize_disciplines_enabled`), and a form
 * that lets you reach an unsaveable state only to be told so is worse than one
 * that does not.
 */
export function DisciplinesField({
  workspaceId,
  value,
  onChange
}: Readonly<{
  workspaceId: number;
  /** Enabled codes, in priority order — the form's `disciplines_enabled`. */
  value: readonly string[];
  onChange: (next: string[]) => void;
}>) {
  const t = useTranslations("adminWorkspace.workspaceSettings.general.disciplines");
  const { data: installed = [] } = useDisciplines(workspaceId);
  // Only installed games get a row: the server has already refused anything else.
  const enabled = value.flatMap((code) => installed.filter((item) => item.code === code));
  const available = installed.filter((item) => !value.includes(item.code));

  return (
    <div className="space-y-2">
      <SortableRows
        items={enabled}
        getId={(item) => item.code}
        onReorder={(next) => onChange(next.map((item) => item.code))}
        className="space-y-2"
      >
        {(item, index) => (
          <EnabledRow
            key={item.code}
            item={item}
            isDefault={index === 0}
            // The only way to have zero would be to turn this one off.
            last={enabled.length === 1}
            onDisable={() => onChange(value.filter((code) => code !== item.code))}
          />
        )}
      </SortableRows>
      {available.map((item) => (
        <div key={item.code} className={cn(ROW_CLASS, "border-dashed")}>
          {/* Same width as the grip, so names line up across both lists. */}
          <span className="size-6 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-[color:var(--aqt-fg-dim)]">{item.name}</span>
          <Switch
            checked={false}
            onCheckedChange={() => onChange([...value, item.code])}
            aria-label={t("toggle", { name: item.name })}
          />
        </div>
      ))}
    </div>
  );
}

function EnabledRow({
  item,
  isDefault,
  last,
  onDisable
}: Readonly<{
  item: DisciplineDescriptor;
  isDefault: boolean;
  last: boolean;
  onDisable: () => void;
}>) {
  const t = useTranslations("adminWorkspace.workspaceSettings.general.disciplines");
  const { ref, style, handleProps, isDragging } = useSortableRow(item.code);

  return (
    <div ref={ref} style={style} className={cn(ROW_CLASS, isDragging && "shadow-lg")}>
      <SortableGrip handleProps={handleProps} label={t("reorder", { name: item.name })} />
      <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
      {isDefault ? <Badge variant="secondary">{t("default")}</Badge> : null}
      <Switch
        checked
        disabled={last}
        onCheckedChange={onDisable}
        aria-label={t("toggle", { name: item.name })}
        title={last ? t("lastEnabled") : undefined}
      />
    </div>
  );
}
