// The step bar of the current phase is a progress track, not decoration: the
// marker's position IS the answer to "how much of this phase is left", and a
// marker pinned to the left edge silently contradicts the countdown next to it.
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import en from "@/i18n/messages/en.json";
import type { Tournament } from "@/types/tournament.types";

import { PhaseTimeline, type PhaseTimelineProps } from "./PhaseTimeline";

const NOW = Date.parse("2026-09-04T15:30:00Z");

type ScheduleTournament = PhaseTimelineProps["tournament"];

function makeTournament(
  status: Tournament["status"],
  schedule: Tournament["phase_schedule"]
): ScheduleTournament {
  return {
    status,
    team_formation: "draft",
    phase_schedule: schedule,
    auto_transitions_enabled: true
  };
}

function render(tournament: ScheduleTournament) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <PhaseTimeline tournament={tournament} orientation="horizontal" now={NOW} />
    </NextIntlClientProvider>
  );
}

describe("PhaseTimeline current-phase marker", () => {
  it("rides the elapsed fraction of the phase window", () => {
    // Check-in opened 30 minutes ago and closes in 15: two thirds spent.
    const html = render(
      makeTournament("check_in", [
        {
          status: "check_in",
          starts_at: new Date(NOW - 30 * 60_000).toISOString(),
          ends_at: new Date(NOW + 15 * 60_000).toISOString()
        }
      ])
    );

    expect(html).toContain("width:66.7%");
    expect(html).toContain("left:clamp(6px, 66.7%, calc(100% - 6px))");
  });

  it("keeps the marker at the segment start when the phase has no closing time", () => {
    const html = render(
      makeTournament("live", [
        { status: "live", starts_at: new Date(NOW - 60 * 60_000).toISOString(), ends_at: null }
      ])
    );

    // No window to measure: no fill, and the marker stays parked at the left.
    expect(html).not.toContain("width:");
    expect(html).not.toContain("clamp(6px");
    expect(html).toContain("left-3");
  });
});
