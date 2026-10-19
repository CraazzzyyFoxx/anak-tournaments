"use client";

import { useTranslations } from "next-intl";

/**
 * Segment kinds the platform has a localized name for. A discipline declares its own kinds (`kind` is free-form
 * wire text), so everything else reads as a neutral numbered segment rather than the raw code.
 */
const KNOWN_KINDS = { round: "matches.round" } as const;

/** The localized label of a match segment: 0 is the whole match, a child segment its kind and number. */
export function useSegmentLabel(segments: readonly { segment: number; kind: string }[]) {
  const t = useTranslations();
  return (value: number): string => {
    if (value === 0) return t("matches.allMatch");
    const kind = segments.find((candidate) => candidate.segment === value)?.kind;
    if (kind !== undefined && Object.hasOwn(KNOWN_KINDS, kind)) {
      return t(KNOWN_KINDS[kind as keyof typeof KNOWN_KINDS], { round: value });
    }
    return t("matches.native.segmentN", { n: value });
  };
}
