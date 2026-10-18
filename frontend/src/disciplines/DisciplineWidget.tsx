"use client";

import { createElement, Suspense, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { useTranslations } from "next-intl";

import { loadDisciplineUI } from "./registry";
import type { DisciplineCapabilities, DisciplineSlot, DisciplineUI, SlotProps } from "./types";

interface DisciplineWidgetProps<K extends DisciplineSlot> {
  discipline: string;
  slot: K;
  capabilities: DisciplineCapabilities;
  /** The native capability this slot needs; a promised-but-unimplemented one is a configuration error. */
  requires?: keyof DisciplineCapabilities;
  /** Native shape check (e.g. exactly two participants); `false` renders `fallback`. */
  applicable?: boolean;
  props: SlotProps[K];
  /** Working generic view (facts table etc.). */
  fallback: ReactNode;
}

type Loaded = { code: string; ui: DisciplineUI | null };

/**
 * Renders one optional module slot (P7 contracts §7). Backend capability and local renderer are separate
 * facts: a capability without its renderer is an explicit configuration error, an unsupported capability is
 * said so, and everything else falls back to the generic view. An unknown discipline never resolves to
 * another game's module.
 */
export function DisciplineWidget<K extends DisciplineSlot>({
  discipline,
  slot,
  capabilities,
  requires,
  applicable = true,
  props,
  fallback
}: Readonly<DisciplineWidgetProps<K>>): ReactNode {
  const t = useTranslations("common.discipline");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const blocked = (requires !== undefined && !capabilities[requires]) || !applicable;

  useEffect(() => {
    if (blocked) return;
    let live = true;
    void loadDisciplineUI(discipline)
      .catch(() => null)
      .then((ui) => {
        if (live) setLoaded({ code: discipline, ui });
      });
    return () => {
      live = false;
    };
  }, [discipline, blocked]);

  if (requires !== undefined && !capabilities[requires]) {
    return <p className="text-sm text-muted-foreground">{t("widgetUnsupported")}</p>;
  }
  if (!applicable) return fallback;

  if (loaded?.code !== discipline) return requires === undefined ? fallback : null;
  const Slot = loaded.ui?.slots[slot] as ComponentType<SlotProps[K]> | undefined;
  if (!Slot) {
    return requires === undefined ? (
      fallback
    ) : (
      <p role="alert" className="text-sm text-destructive">
        {t("widgetMissing")}
      </p>
    );
  }
  return <Suspense fallback={null}>{createElement(Slot, props)}</Suspense>;
}
