"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** One dashboard section: a titled card that loads, fails and hides on its own. */
export function Block({
  title,
  description,
  action,
  className,
  children
}: Readonly<{
  title: string;
  description?: ReactNode;
  /** One control in the header (a toggle, a link). */
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}>) {
  return (
    <Card asChild className={className}>
      <section aria-label={title}>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <CardTitle asChild>
              <h2>{title}</h2>
            </CardTitle>
            {action}
          </div>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </section>
    </Card>
  );
}

/** A failed read says so in place, never as a zero, and offers the retry. */
export function BlockError({ title, onRetry }: Readonly<{ title: string; onRetry: () => void }>) {
  const t = useTranslations("adminShell.dashboard");
  const tCommon = useTranslations("common");
  return (
    <Alert variant="destructive">
      <AlertTriangle className="size-4" aria-hidden />
      <AlertTitle>{t("loadFailed", { block: title })}</AlertTitle>
      <AlertDescription>
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          {tCommon("retry")}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
