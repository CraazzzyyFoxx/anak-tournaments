"use client";

import React from "react";

import { useTranslations } from "next-intl";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { GlossaryTerm } from "@/disciplines/overwatch/analytics/analytics-glossary";

export type SheetState = { kind: "term"; term: GlossaryTerm } | { kind: "how" };

interface BottomSheetProps {
  state: SheetState | null;
  onClose: () => void;
}

function Kicker({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <span className="text-label uppercase tracking-label text-[color:var(--aqt-fg-faint)]">{children}</span>
  );
}

function TermBody({ term }: Readonly<{ term: GlossaryTerm }>) {
  const t = useTranslations();
  return (
    <SheetHeader>
      <Kicker>{t("analytics.sheet.glossaryKicker")}</Kicker>
      <SheetTitle className="text-heading font-semibold">{t(`analytics.glossary.${term}.label`)}</SheetTitle>
      <SheetDescription className="text-body text-[color:var(--aqt-fg-muted)]">
        {t(`analytics.glossary.${term}.plain`)}
      </SheetDescription>
    </SheetHeader>
  );
}

function HowBody() {
  const t = useTranslations();
  const steps = [1, 2, 3] as const;
  return (
    <>
      <SheetHeader>
        <Kicker>{t("analytics.howItWorks.kicker")}</Kicker>
        <SheetTitle className="text-heading font-semibold">{t("analytics.howItWorks.title")}</SheetTitle>
        <SheetDescription className="text-body text-[color:var(--aqt-fg-muted)]">
          {t("analytics.howItWorks.intro")}
        </SheetDescription>
      </SheetHeader>
      <ol className="mt-4 flex flex-col gap-4">
        {steps.map((step) => (
          <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2" key={step}>
            <span className="aqt-tnum pt-px text-label text-[color:var(--aqt-fg-faint)]">{`0${step}`}</span>
            <span>
              <span className="block text-ui font-semibold text-[color:var(--aqt-fg)]">
                {t(`analytics.howItWorks.step${step}Title`)}
              </span>
              <span className="mt-0.5 block text-body text-[color:var(--aqt-fg-muted)]">
                {t(`analytics.howItWorks.step${step}Body`)}
              </span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-caption text-[color:var(--aqt-fg-dim)]">{t("analytics.howItWorks.foot")}</p>
    </>
  );
}

/**
 * Glossary / how-it-works explainer on the shared Sheet (a bottom drawer). It
 * only mounts while open (Radix portal). Opened by the info dots and the hero's
 * "how this works" action.
 */
export default function BottomSheet({ state, onClose }: Readonly<BottomSheetProps>) {
  return (
    <Sheet
      open={state != null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="bottom" className="mx-auto max-h-[85vh] max-w-lg overflow-y-auto">
        {state?.kind === "term" ? <TermBody term={state.term} /> : null}
        {state?.kind === "how" ? <HowBody /> : null}
      </SheetContent>
    </Sheet>
  );
}
