"use client";

import { useId, useRef, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useSettingsOutlineEntry } from "./SettingsOutline";

/** Id of the error line a `SettingRow` renders for the control `controlId`. */
export function settingErrorId(controlId: string): string {
  return `${controlId}-error`;
}

/** Id of the label a `SettingRow` renders for the control `controlId`. */
export function settingLabelId(controlId: string): string {
  return `${controlId}-label`;
}

/**
 * Id of the hint a `SettingRow` renders for the control `controlId`: a control
 * the label alone cannot explain (a switch) points `aria-describedby` at it.
 */
export function settingHintId(controlId: string): string {
  return `${controlId}-hint`;
}

/**
 * The control half of an inline error: spread on the control whose row gets
 * the same `error`, so the field is marked and names its message.
 */
export function invalidProps(controlId: string, error: string | undefined) {
  return error
    ? ({ "aria-invalid": true, "aria-describedby": settingErrorId(controlId) } as const)
    : {};
}

/** Characters used against a limit. `soft` is advice (search snippets), not a cap. */
export interface SettingRowCount {
  value: number;
  max: number;
  soft?: boolean;
}

/**
 * One setting: what it is and why on the left, the control on the right.
 *
 * `stacked` puts the control under its label at full width, for the values a
 * half column cannot hold: text a reader types, Markdown, a record table. A
 * group narrower than `@xl` (36rem) stacks every row, from the same DOM.
 *
 * `error` renders under the control, with an icon and words (never colour
 * alone); pair it with `invalidProps(htmlFor, error)` on the control. `count`
 * sits at the end of the label line.
 *
 * Lived inside `RegistrationFormBuilder` until the registration policy moved
 * into the settings rail; every settings section now builds rows from it, and
 * a second copy of a 12-line layout primitive is how two settings pages start
 * drifting apart visually.
 */
export function SettingRow({
  htmlFor,
  label,
  hint,
  stacked = false,
  error,
  count,
  children
}: Readonly<{
  htmlFor?: string;
  label: string;
  hint?: ReactNode;
  stacked?: boolean;
  error?: string;
  count?: SettingRowCount;
  children: ReactNode;
}>) {
  const fallbackId = useId();
  const errorId = htmlFor ? settingErrorId(htmlFor) : fallbackId;
  const over = count ? count.value > count.max : false;

  return (
    <div
      className={cn(
        "grid gap-2 py-3 first:pt-0 last:pb-0",
        // The container, not the viewport, decides: beside the admin sidebar
        // and the section rail a 1024px window leaves a form too narrow for
        // two columns, and a dialog never has room for them.
        !stacked && "@xl:grid-cols-2 @xl:items-center @xl:gap-6"
      )}
    >
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <Label
            id={htmlFor ? settingLabelId(htmlFor) : undefined}
            htmlFor={htmlFor}
            className="text-sm font-medium text-foreground"
          >
            {label}
          </Label>
          {count ? (
            <span
              className={cn(
                "aqt-tnum shrink-0 text-label",
                over ? (count.soft ? "text-warning" : "text-danger") : "text-muted-foreground"
              )}
            >
              {count.value} / {count.max}
            </span>
          ) : null}
        </div>
        {hint ? (
          <p id={htmlFor ? settingHintId(htmlFor) : undefined} className="mt-0.5 max-w-prose text-xs text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </div>
      <div className="min-w-0">
        <div className={cn("flex min-w-0 items-center", !stacked && "@xl:justify-end")}>
          {children}
        </div>
        {error ? (
          <p id={errorId} role="alert" className="mt-1.5 flex items-start gap-1.5 text-caption text-danger">
            <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0 [overflow-wrap:anywhere]">{error}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A titled group of rows, framed as one card: a settings page is a stack of
 * these, so each group reads as its own unit instead of a stretch of one long
 * form. Rows are separated by hairlines inside the card, never by another
 * frame (DESIGN §5, one level of framing).
 *
 * `id` is the group's anchor: stable and locale-free, because it is what a
 * `#fragment` link and the section rail's outline (`SettingsOutline`) point at.
 *
 * `immediate` marks a group whose controls act on their own (an upload, a
 * transfer, a DNS check) rather than through the page's save bar, so the two
 * save models never share a group without saying so.
 *
 * `level` is the title's heading rank: 2 under a page `h1`, deeper inside a
 * dialog whose own title and section heading sit above the group.
 */
export function SettingGroup({
  id,
  title,
  description,
  immediate = false,
  level = 2,
  children
}: Readonly<{
  id: string;
  title: string;
  description?: ReactNode;
  immediate?: boolean;
  level?: 2 | 3 | 4;
  children: ReactNode;
}>) {
  const t = useTranslations("kit.settings");
  const titleId = useId();
  const ref = useRef<HTMLElement>(null);
  useSettingsOutlineEntry(id, title, ref);
  const Heading = `h${level}` as const;

  return (
    // `scroll-mt-16` keeps a jumped-to group clear of the admin top bar.
    <Card asChild className="scroll-mt-16">
      <section id={id} ref={ref} aria-labelledby={titleId}>
        <header className="px-5 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <Heading id={titleId} className="text-ui font-semibold text-foreground">
              {title}
            </Heading>
            {immediate ? (
              <p className="text-xs text-muted-foreground">{t("appliesImmediately")}</p>
            ) : null}
          </div>
          {description ? (
            <p className="mt-0.5 max-w-prose text-xs text-muted-foreground">{description}</p>
          ) : null}
        </header>
        <div className="@container divide-y divide-border/60 border-t border-border px-5 py-3">
          {children}
        </div>
      </section>
    </Card>
  );
}
