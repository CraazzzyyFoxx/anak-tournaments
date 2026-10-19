"use client";

import { useTranslations } from "next-intl";

import { TONE_TEXT } from "@/components/kit/tone";
import { StatusDot } from "@/components/ui/status-dot";
import { cn } from "@/lib/utils";
import type { AdminSessionStatus } from "@/types/rbac.types";

import { STATUS_META } from "./model";

export function SessionStatusCell({ status }: Readonly<{ status: AdminSessionStatus }>) {
  const t = useTranslations("adminAccess.common");
  const meta = STATUS_META[status];

  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-xs font-medium", TONE_TEXT[meta.tone])}
    >
      <StatusDot />
      {t(status)}
    </span>
  );
}
