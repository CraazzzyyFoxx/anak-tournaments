"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { PageStateCard } from "@/components/ui/page-state-card";

export default function TournamentShellError() {
  const router = useRouter();
  const t = useTranslations();

  return (
    <div className="aqt-tn">
      <PageStateCard
        state="error"
        headingLevel={1}
        title={t("common.loadError")}
        onAction={() => router.refresh()}
      />
    </div>
  );
}
