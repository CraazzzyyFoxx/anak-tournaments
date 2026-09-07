"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { AnnouncementCreateBody } from "@/types/notification.types";

import {
  ANNOUNCEMENT_LOCALES,
  emptyAnnouncementDraft,
  filledLocales,
  validateAnnouncementDraft,
  type AnnouncementAudience,
  type AnnouncementDraft,
  type AnnouncementDraftError,
  type AnnouncementLocale,
} from "./announcement-draft";

interface AnnouncementFormProps {
  /** Owned by the page: the feed on screen and the audience written are one choice. */
  audience: AnnouncementAudience;
  workspaceId: number | null;
  isPublishing: boolean;
  onPublish: (body: AnnouncementCreateBody) => void;
}

/**
 * Compose one announcement, one tab per locale.
 *
 * Tabs rather than two stacked forms because the locales are alternatives, not
 * sections: only one of them is ever read by any given visitor, and stacking
 * them reads as "fill both" even where one is enough.
 *
 * Every rule the operator can break is decided by `validateAnnouncementDraft`,
 * including which fallback locales this form is allowed to offer — the button
 * refuses for exactly the reason the server would, and says which.
 */
export function AnnouncementForm({
  audience,
  workspaceId,
  isPublishing,
  onPublish,
}: Readonly<AnnouncementFormProps>) {
  const t = useTranslations<never>();
  const [form, setForm] = useState(() => emptyAnnouncementDraft(audience, workspaceId));
  const [tab, setTab] = useState<AnnouncementLocale>(ANNOUNCEMENT_LOCALES[0]);
  const [error, setError] = useState<AnnouncementDraftError | null>(null);

  // The audience lives on the page, so it is merged in rather than mirrored:
  // a copy here would need syncing, and a stale one would validate the draft
  // against the wrong locale rule.
  const draft: AnnouncementDraft = { ...form, audience, workspaceId };
  const filled = filledLocales(draft);

  const setLocaleText = (locale: AnnouncementLocale, field: "title" | "body", value: string) => {
    setError(null);
    setForm((current) => ({
      ...current,
      locales: { ...current.locales, [locale]: { ...current.locales[locale], [field]: value } },
    }));
  };

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const result = validateAnnouncementDraft(draft);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    onPublish(result.body);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("notifications.admin.form.title")}</CardTitle>
        <CardDescription>
          {audience === "global"
            ? t("notifications.admin.form.globalHint")
            : t("notifications.admin.form.workspaceHint")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          <Tabs value={tab} onValueChange={(next) => setTab(next as AnnouncementLocale)}>
            <TabsList>
              {ANNOUNCEMENT_LOCALES.map((locale) => (
                <TabsTrigger key={locale} value={locale} data-field={`locale-tab-${locale}`}>
                  {t(`notifications.admin.locales.${locale}`)}
                  {filled.includes(locale) ? null : (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {t("notifications.admin.form.localeEmpty")}
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
            {ANNOUNCEMENT_LOCALES.map((locale) => (
              <TabsContent key={locale} value={locale} className="space-y-3 pt-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`announcement-title-${locale}`}>
                    {t("notifications.admin.form.titleField")}
                  </Label>
                  <Input
                    id={`announcement-title-${locale}`}
                    data-field={`title-${locale}`}
                    maxLength={200}
                    value={form.locales[locale].title}
                    onChange={(event) => setLocaleText(locale, "title", event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`announcement-body-${locale}`}>
                    {t("notifications.admin.form.bodyField")}
                  </Label>
                  <Textarea
                    id={`announcement-body-${locale}`}
                    data-field={`body-${locale}`}
                    maxLength={4000}
                    rows={3}
                    value={form.locales[locale].body}
                    onChange={(event) => setLocaleText(locale, "body", event.target.value)}
                  />
                </div>
              </TabsContent>
            ))}
          </Tabs>

          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t("notifications.admin.form.defaultLocale")}</p>
            {/* Offered from the same `filledLocales` the validator reads, so
                "default_locale has no text" is unreachable rather than merely
                caught. Nothing written yet means nothing to choose between. */}
            {filled.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-field="default-locale">
                {t("notifications.admin.form.defaultLocaleEmpty")}
              </p>
            ) : (
              <div data-field="default-locale">
                <ToggleGroup
                  type="single"
                  value={filled.includes(form.defaultLocale) ? form.defaultLocale : ""}
                  onValueChange={(next) =>
                    setForm((current) => ({ ...current, defaultLocale: next as AnnouncementLocale }))
                  }
                  aria-label={t("notifications.admin.form.defaultLocale")}
                >
                  {filled.map((locale) => (
                    <ToggleGroupItem key={locale} value={locale}>
                      {t(`notifications.admin.locales.${locale}`)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {t("notifications.admin.form.defaultLocaleHint")}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="announcement-href">{t("notifications.admin.form.href")}</Label>
              <Input
                id="announcement-href"
                data-field="href"
                maxLength={512}
                placeholder="/tournaments"
                value={form.href}
                onChange={(event) =>
                  setForm((current) => ({ ...current, href: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="announcement-published-at">
                {t("notifications.admin.form.publishedAt")}
              </Label>
              {/* Native pickers: a scheduled announcement is a wall-clock
                  decision, and the browser's own control already speaks the
                  operator's locale and time zone. */}
              <Input
                id="announcement-published-at"
                data-field="published-at"
                type="datetime-local"
                value={form.publishedAt}
                onChange={(event) =>
                  setForm((current) => ({ ...current, publishedAt: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="announcement-expires-at">
                {t("notifications.admin.form.expiresAt")}
              </Label>
              <Input
                id="announcement-expires-at"
                data-field="expires-at"
                type="datetime-local"
                value={form.expiresAt}
                onChange={(event) =>
                  setForm((current) => ({ ...current, expiresAt: event.target.value }))
                }
              />
            </div>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {t(`notifications.admin.errors.${error}`)}
            </p>
          ) : null}

          <div className="flex justify-end">
            <Button type="submit" data-field="publish" disabled={isPublishing}>
              {t("notifications.admin.form.publish")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
