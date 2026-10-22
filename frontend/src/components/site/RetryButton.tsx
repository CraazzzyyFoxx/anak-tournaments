"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * "Повторить" for a server-rendered block that failed to load: re-renders the
 * route's server components, which re-runs the failed read.
 */
export function RetryButton() {
  const t = useTranslations("site.state");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="subtle"
      size="sm"
      disabled={pending}
      aria-busy={pending}
      onClick={() => startTransition(() => router.refresh())}
      className="mt-2.5"
    >
      <RefreshCw className={cn(pending && "motion-safe:animate-spin")} aria-hidden />
      {t("retry")}
    </Button>
  );
}
