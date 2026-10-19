"use client";

import { useId, type ReactNode } from "react";
import { useTranslations } from "next-intl";

import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * One setting: what it is and why on the left, the control on the right.
 *
 * `stacked` puts the control under its label at full width, for the values a
 * half column cannot hold: long text, Markdown, a record table. A group
 * narrower than `@xl` (36rem) stacks every row, from the same DOM.
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
  children
}: Readonly<{
  htmlFor?: string;
  label: string;
  hint?: ReactNode;
  stacked?: boolean;
  children: ReactNode;
}>) {
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
        <Label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
          {label}
        </Label>
        {hint ? <p className="mt-0.5 max-w-prose text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <div className={cn("flex min-w-0 items-center", !stacked && "@xl:justify-end")}>
        {children}
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
 * `immediate` marks a group whose controls act on their own (an upload, a
 * transfer, a DNS check) rather than through the page's save bar, so the two
 * save models never share a group without saying so.
 */
export function SettingGroup({
  title,
  description,
  immediate = false,
  children
}: Readonly<{
  title: string;
  description?: ReactNode;
  immediate?: boolean;
  children: ReactNode;
}>) {
  const t = useTranslations("kit.settings");
  const titleId = useId();

  return (
    <Card asChild>
      <section aria-labelledby={titleId}>
        <header className="px-5 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id={titleId} className="text-ui font-semibold text-foreground">
              {title}
            </h2>
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
