"use client";

import React from "react";

import type { Tournament } from "@/types/tournament.types";
import { SelectContent, SelectGroup, SelectItem } from "@/components/ui/select";
import { TooltipSelect } from "@/components/ui/tooltip-select";
import { useTranslations } from "next-intl";
import styles from "@/app/(site)/tournaments/analytics/components/Analytics.module.css";

interface AnalyticsPickerProps {
  tournaments: Tournament[];
  tournamentId: number | null;
  loadingTournaments: boolean;
  isErrorTournaments: boolean;
  onTournamentChange: (value: string) => void;
  /** The game's own controls (its ranking picker), beside the tournament select. */
  controls?: React.ReactNode;
}

/**
 * The tournament selector (plus the game board's own controls) as a compact,
 * label-less control row in the hero's right rail; each select carries a tooltip.
 */
export default function AnalyticsPicker({
  tournaments,
  tournamentId,
  loadingTournaments,
  isErrorTournaments,
  onTournamentChange,
  controls
}: Readonly<AnalyticsPickerProps>) {
  const t = useTranslations();

  return (
    <div className={styles.cPickerRow}>
      <TooltipSelect
        tooltip={t("analytics.briefing.tournament")}
        value={tournamentId == null ? "" : tournamentId.toString()}
        placeholder={
          loadingTournaments
            ? t("analytics.briefing.loadingTournaments")
            : isErrorTournaments
              ? t("analytics.briefing.errorTournaments")
              : t("analytics.briefing.selectTournament")
        }
        disabled={loadingTournaments || isErrorTournaments}
        className={styles.cPickTournament}
        onValueChange={onTournamentChange}
      >
        <SelectContent className="max-h-[min(var(--radix-select-content-available-height),20rem)]">
          <SelectGroup>
            {tournaments.map((item) => (
              <SelectItem key={item.id} value={item.id.toString()}>
                {item.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </TooltipSelect>
      {controls}
    </div>
  );
}
