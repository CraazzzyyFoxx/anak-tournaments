"use client";

import React from "react";
import { useLocale, useTranslations } from "next-intl";

import { type CommunityVerdict, formatPlace } from "@/disciplines/overwatch/analytics/analytics.helpers";
import type { GlossaryTerm } from "@/disciplines/overwatch/analytics/analytics-glossary";

import InfoDot from "./InfoDot";

/** The sentence with its team's name weighted: the name is the fact, not the colour. */
function withTeam(text: string, name: string): React.ReactNode {
  const index = text.indexOf(name);
  if (index === -1) return text;
  return (
    <>
      {text.slice(0, index)}
      <b className="font-semibold text-[color:var(--aqt-fg)]">{name}</b>
      {text.slice(index + name.length)}
    </>
  );
}

interface VerdictLedeProps {
  verdict: CommunityVerdict;
  onExplain: (term: GlossaryTerm) => void;
}

/**
 * The hero's lede: who beat the forecast by the most and who fell furthest
 * short, as one paragraph of inline text (the hero wraps it in its `<p>`); a
 * calm single sentence while nobody has strayed.
 */
export default function VerdictLede({ verdict, onExplain }: Readonly<VerdictLedeProps>) {
  const t = useTranslations();
  const locale = useLocale() as "en" | "ru";
  const { story, letdown } = verdict;

  if (!story && !letdown) return <>{t("analytics.community.verdict.empty")}</>;

  return (
    <>
      {story
        ? withTeam(
            t("analytics.community.verdict.story", {
              team: story.name,
              predicted: formatPlace(story.predicted, locale),
              place: formatPlace(story.place, locale)
            }),
            story.name
          )
        : null}
      {story && letdown ? " " : null}
      {letdown
        ? withTeam(
            t("analytics.community.verdict.letdown", {
              team: letdown.name,
              predicted: formatPlace(letdown.predicted, locale),
              place: formatPlace(letdown.place, locale)
            }),
            letdown.name
          )
        : null}{" "}
      <InfoDot term="predicted_move" onExplain={onExplain} />
    </>
  );
}
