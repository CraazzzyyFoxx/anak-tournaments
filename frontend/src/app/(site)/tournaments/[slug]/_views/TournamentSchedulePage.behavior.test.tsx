// @vitest-environment happy-dom
//
// This page answers one question: when does each phase of this tournament
// happen, and what can I still do inside the one that is running.
//
// The trap it is built around is that `starts_at` is a PLAN. Only the worker
// tick moves `Tournament.status`, and `auto_transitions_enabled` can switch that
// tick off entirely, so a wall-clock comparison would announce a phase as
// running while the tournament still sits in the previous one — and count down
// past zero into negative time while doing it.
//
// What is pinned here:
//  1. phase state comes from `tournament.status`, never from the clock;
//  2. exactly one boundary counts down, and never a boundary already passed;
//  3. `ends_at` is presented as the phase's own closing time, with the footnote
//     that says it does not advance the tournament;
//  4. an unscheduled phase and a balancer tournament's draft row are absent;
//  5. an unscheduled tournament says so instead of rendering a row of dashes;
//  6. stamps land in the VIEWER's zone and name it, so nobody has to guess
//     which clock a time is quoted in. `Europe/Moscow` stands in for that zone
//     below precisely because it is not UTC — under UTC the shift and the label
//     would both be invisible. The provider is deliberately given the WRONG
//     zone: in production next-intl resolves its default on the server (UTC in
//     the container) and `NextIntlClientProvider` inherits it, so a page that
//     trusts the formatter's default quotes every time in the deployment's
//     clock. The viewer's zone has to come from the browser.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import type { Tournament, TournamentStatus } from "@/types/tournament.types";

import TournamentSchedulePage from "./TournamentSchedulePage";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getPublicOverview = vi.fn();

vi.mock("@/services/tournament.service", () => ({
  default: { getPublicOverview: (...args: unknown[]) => getPublicOverview(...args) }
}));

const COPY = en.tournamentDetail.publicPages.schedule;
const TOURNAMENT_ID = 91;
/**
 * The viewer's zone — the browser's, so the page must read it from `Intl`. Set
 * on `process.env.TZ` rather than left to the runner's machine: a suite that
 * only passes in UTC+3 pins nothing.
 */
const VIEWER_ZONE = "Europe/Moscow";
process.env.TZ = VIEWER_ZONE;
/** What the provider carries in production: the deployment's zone, not the viewer's. */
const DEPLOYMENT_ZONE = "UTC";

const T = (hour: number, minute = 0) =>
  `2026-08-10T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`;

/**
 * Every field spelled out rather than cast into place: `tsconfig.json` excludes
 * test files, so a fixture that lies about its shape type-checks green and feeds
 * the component a hole.
 */
function tournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: TOURNAMENT_ID,
    created_at: new Date(0),
    updated_at: null,
    workspace_id: 1,
    name: "Anak Cup",
    start_date: new Date("2026-08-10T00:00:00Z"),
    end_date: new Date("2026-08-12T00:00:00Z"),
    description: null,
    challonge_id: null,
    challonge_slug: null,
    is_league: false,
    is_finished: false,
    is_hidden: false,
    team_formation: "balancer",
    status: "registration",
    auto_transitions_enabled: true,
    allow_late_registration: false,
    phase_schedule: [
      { status: "registration", starts_at: T(10), ends_at: T(18) },
      { status: "check_in", starts_at: T(19), ends_at: T(19, 45) },
      { status: "live", starts_at: T(20), ends_at: null }
    ],
    win_points: 1,
    draw_points: 0.5,
    loss_points: 0,
    stages: [],
    participants_count: 0,
    registrations_count: 0,
    teams_count: 0,
    division_grid_version_id: null,
    division_grid_version: null,
    roster_slots_json: null,
    roster_shape: null,
    roster_locked_by_draft: null,
    ...overrides
  };
}

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.useRealTimers();
});

/** Let queued promise callbacks and React Query's own scheduling drain. */
async function settle(ticks = 3) {
  for (let index = 0; index < ticks; index += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

/**
 * Renders at a fixed wall clock. Fake timers are installed before the render so
 * the hydration effect's `Date.now()` lands on `now`, which is what makes the
 * countdown assertions deterministic.
 *
 * Each call mounts a FRESH root. Re-rendering a second fixture into the same
 * root left the first one's DOM in place — React saw the same element type and
 * React Query the same key, so two tests asserted against the previous
 * tournament's schedule and passed for the wrong reason.
 */
async function render(overrides: Partial<Tournament>, now: string) {
  vi.setSystemTime(new Date(now));
  getPublicOverview.mockResolvedValue(tournament(overrides));
  if (root) act(() => root?.unmount());
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root?.render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={en} timeZone={DEPLOYMENT_ZONE}>
          <TournamentSchedulePage slug={String(TOURNAMENT_ID)} />
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  });
  await settle();
  return container.textContent ?? "";
}

/** One entry per rendered phase, in DOM order. */
function rows() {
  return Array.from(container.querySelectorAll("li")).map((li) => ({
    label: li.querySelector("span.text-sm")?.textContent?.trim() ?? null,
    current: li.getAttribute("aria-current") === "step",
    stamps: Array.from(li.querySelectorAll("time")).map((time) => ({
      dateTime: time.getAttribute("dateTime") ?? time.getAttribute("datetime"),
      text: time.textContent?.trim() ?? ""
    })),
    text: li.textContent ?? ""
  }));
}

describe("public tournament schedule page", () => {
  it("lists the scheduled phases in lifecycle order with both boundaries", async () => {
    await render({}, T(11));

    expect(rows().map((row) => row.label)).toEqual([
      en.common.statusBadge.registration,
      en.common.statusBadge.check_in,
      en.common.statusBadge.live
    ]);
    // Machine-readable instants stay exact regardless of how they are displayed,
    // so a scraper and a screen reader read the schedule the same way.
    expect(rows().flatMap((row) => row.stamps.map((stamp) => stamp.dateTime))).toEqual([
      T(10),
      T(18),
      T(19),
      T(19, 45),
      T(20)
    ]);
    expect(rows()[2].text).not.toContain(COPY.closesLabel);
  });

  it("quotes every time in the viewer's own zone and names that zone", async () => {
    await render({}, T(11));
    const [registration] = rows();

    // 10:00Z and 18:00Z, seen from UTC+3, with the offset spelled out.
    expect(registration.stamps.map((stamp) => stamp.text)).toEqual([
      "Aug 10, 01:00 PM GMT+3",
      "Aug 10, 09:00 PM GMT+3"
    ]);
    expect(container.textContent).not.toContain("UTC");
  });

  it("takes the running phase from the status, not from the wall clock", async () => {
    // Two hours past the planned Live start; the tournament never left
    // registration because nothing advanced it.
    await render({ status: "registration" }, T(22));

    expect(rows().map((row) => row.current)).toEqual([true, false, false]);
    expect(rows()[0].text).toContain(COPY.state.current);
    expect(container.textContent).not.toContain(COPY.state.done);
  });

  it("counts the running phase down to its own closing time", async () => {
    await render({ status: "check_in" }, T(19, 30));
    const [registration, checkIn, live] = rows();

    expect(registration.text).toContain(COPY.state.done);
    expect(checkIn.current).toBe(true);
    expect(checkIn.text).toContain("Closes in 15 minutes");
    // Exactly one boundary is live, so two timers can never disagree about what
    // happens next.
    expect(live.text).not.toContain("in ");
  });

  it("counts the running phase down to its own start when the plan has not landed", async () => {
    // The organizer flipped the tournament to live ten minutes before the
    // planned kickoff — the phase is running, the play is not. "When does this
    // begin" is the only question the page can still answer here, and an
    // absolute stamp alone does not answer it.
    await render({ status: "live" }, T(19, 50));
    const [registration, checkIn, live] = rows();

    expect(live.current).toBe(true);
    expect(live.text).toContain("Starts in 10 minutes");
    expect(live.text).not.toContain(COPY.closesLabel);
    for (const done of [registration, checkIn]) expect(done.text).not.toContain("in ");
  });

  it("counts down to the next phase when the running one never closes", async () => {
    await render(
      {
        status: "registration",
        phase_schedule: [
          { status: "registration", starts_at: T(10), ends_at: null },
          { status: "check_in", starts_at: T(19), ends_at: T(19, 45) }
        ]
      },
      T(18)
    );

    expect(rows()[1].text).toContain("Starts in 1 hour");
  });

  it("never counts past a boundary automation did not execute", async () => {
    await render({ status: "registration", auto_transitions_enabled: false }, T(19, 30));

    // Registration's own window closed 90 minutes ago and check-in's planned
    // start is 30 minutes past — neither may render as time remaining.
    expect(container.textContent).not.toContain("ago");
    expect(container.textContent).not.toContain("in ");
    // Manual mode is stated instead of implied, so a stale-looking plan reads as
    // deliberate rather than broken.
    expect(container.textContent).toContain(COPY.manualHint);
  });

  it("marks every phase done once play moves past them", async () => {
    for (const status of ["playoffs", "completed", "archived"] as TournamentStatus[]) {
      const text = await render({ status }, T(23));
      expect(rows().every((row) => row.text.includes(COPY.state.done))).toBe(true);
      expect(text).not.toContain(COPY.state.current);
    }
  });

  it("explains that a closing time does not advance the tournament", async () => {
    expect(await render({}, T(11))).toContain(COPY.windowHint);
    // Nothing closes early here, so the footnote has nothing to explain.
    expect(
      await render({ phase_schedule: [{ status: "live", starts_at: T(20), ends_at: null }] }, T(11))
    ).not.toContain(COPY.windowHint);
  });

  it("omits phases the organizer left unscheduled", async () => {
    await render(
      {
        phase_schedule: [
          { status: "registration", starts_at: T(10), ends_at: T(18) },
          { status: "live", starts_at: T(20), ends_at: null }
        ]
      },
      T(11)
    );

    expect(rows().map((row) => row.label)).toEqual([
      en.common.statusBadge.registration,
      en.common.statusBadge.live
    ]);
  });

  it("omits a draft row on a tournament that does not draft", async () => {
    const phase_schedule: Tournament["phase_schedule"] = [
      { status: "registration", starts_at: T(10), ends_at: null },
      { status: "draft", starts_at: T(19), ends_at: null }
    ];

    await render({ phase_schedule }, T(11));
    expect(rows().map((row) => row.label)).toEqual([en.common.statusBadge.registration]);

    await render({ phase_schedule, team_formation: "draft" }, T(11));
    expect(rows().map((row) => row.label)).toEqual([
      en.common.statusBadge.registration,
      en.common.statusBadge.draft
    ]);
  });

  it("offers the organizer's own wording when there is no schedule at all", async () => {
    const text = await render({ phase_schedule: [] }, T(11));

    expect(text).toContain(COPY.emptyTitle);
    expect(text).toContain(COPY.emptyDescription);
    expect(rows()).toHaveLength(0);
  });
});
