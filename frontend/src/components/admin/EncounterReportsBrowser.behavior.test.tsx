// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EncounterReportsBrowser } from "@/components/admin/EncounterReportsBrowser";
import type {
  AdminCaptainReport,
  EncounterReportsQuery,
  EncounterReportsRow
} from "@/types/admin.types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const listEncounterReports = vi.fn();
const getEncounterReportStats = vi.fn();

vi.mock("@/services/admin.service", () => ({
  default: {
    listEncounterReports: (...args: unknown[]) => listEncounterReports(...args),
    getEncounterReportStats: (...args: unknown[]) => getEncounterReportStats(...args)
  }
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/admin/match-reports" }));

vi.mock("@/app/admin/tournaments/[id]/components/tournamentWorkspace.queryKeys", () => ({
  invalidateTournamentWorkspace: vi.fn()
}));

// The resolve dialog has its own behaviour suite; here it only has to report
// whether the browser handed it a row.
vi.mock("@/components/admin/ResolveResultDialog", () => ({
  ResolveResultDialog: ({ open, row }: { open: boolean; row: EncounterReportsRow | null }) =>
    open ? <div data-testid="resolve">{row?.name}</div> : null
}));

async function tick() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitFor<T>(read: () => T | null | undefined | false, what: string): Promise<T> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const value = read();
    if (value) return value as T;
    await tick();
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function mount(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(container);
  await act(async () => {
    root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  });
  await tick();
  return container;
}

async function click(element: Element | null | undefined) {
  expect(element).toBeTruthy();
  await act(async () => {
    (element as HTMLElement).click();
  });
  await tick();
}

function button(scope: ParentNode, text: string) {
  return Array.from(scope.querySelectorAll("button")).find(
    (element) => element.textContent?.trim() === text
  );
}

function dataRows(scope: ParentNode) {
  return Array.from(scope.querySelectorAll("tbody tr"));
}

function bodyText(scope: ParentNode) {
  return scope.querySelector("tbody")?.textContent ?? "";
}

function lastQuery(): EncounterReportsQuery {
  return listEncounterReports.mock.calls.at(-1)![0] as EncounterReportsQuery;
}

function report(overrides: Partial<AdminCaptainReport> = {}): AdminCaptainReport {
  return {
    id: 1,
    encounter_id: 11,
    team_id: 1,
    side: "home",
    reporter_user_id: 5,
    reporter_name: "captain-alpha",
    home_score: 3,
    away_score: 1,
    closeness: 4,
    map_codes: [],
    comment: null,
    custom_fields: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: null,
    ...overrides
  };
}

function row(overrides: Partial<EncounterReportsRow> = {}): EncounterReportsRow {
  return {
    id: 11,
    name: "Alpha vs Beta",
    tournament_id: 3,
    tournament_name: "Spring Cup",
    stage_name: "Group A",
    stage_type: "round_robin",
    round: 2,
    best_of: 3,
    status: "completed",
    result_status: "disputed",
    scheduled_at: null,
    home_team: { id: 1, name: "Alpha" },
    away_team: { id: 2, name: "Beta" },
    home_report: report(),
    away_report: report({ id: 2, side: "away", home_score: 1, away_score: 3 }),
    reported_count: 2,
    scores_match: false,
    series_score_valid: true,
    last_resolution: null,
    ...overrides
  };
}

function pageOf(results: EncounterReportsRow[], total = results.length) {
  return { results, total, page: 1, per_page: 25 };
}

describe("EncounterReportsBrowser", () => {
  beforeEach(() => {
    listEncounterReports.mockReset();
    getEncounterReportStats.mockReset();
    listEncounterReports.mockResolvedValue(pageOf([row()]));
    getEncounterReportStats.mockResolvedValue({
      by_result_status: { confirmed: 7, disputed: 2 },
      mismatch_count: 3,
      awaiting_second_count: 1
    });
    window.history.replaceState(null, "", "/admin/match-reports");
    document.body.innerHTML = "";
  });

  it("renders each encounter and both captains' reports through the shared table", async () => {
    const container = await mount(
      <EncounterReportsBrowser tournamentId={null} workspaceId={4} canUpdateEncounter />
    );
    await waitFor(() => bodyText(container).includes("Alpha vs Beta"), "the encounter row");

    expect(container.querySelector("table")).toBeTruthy();
    const text = bodyText(container);
    expect(text).toContain("Spring Cup");
    expect(text).toContain("Group A");
    expect(text).toContain("Round 2");
    // The three-valued verdict, in the row rather than only in a dialog.
    expect(text).toContain("Reports disagree");
    expect(text).toContain("captain-alpha");
  });

  it("maps each chip to exactly one server filter", async () => {
    const container = await mount(
      <EncounterReportsBrowser tournamentId={null} workspaceId={4} canUpdateEncounter />
    );
    await waitFor(() => listEncounterReports.mock.calls.length > 0, "the list request");

    await click(button(container, "Disputed"));
    expect(lastQuery().result_status).toEqual(["disputed"]);

    await click(button(container, "Reports disagree"));
    expect(lastQuery().mismatch_only).toBe(true);
    expect(lastQuery().result_status).toBeUndefined();

    await click(button(container, "Awaiting second"));
    expect(lastQuery().reported_count).toBe(1);
    expect(lastQuery().mismatch_only).toBeUndefined();

    await click(button(container, "No reports"));
    expect(lastQuery().reported_count).toBe(0);

    await click(button(container, "All"));
    expect(lastQuery().result_status).toBeUndefined();
    expect(lastQuery().mismatch_only).toBeUndefined();
    expect(lastQuery().reported_count).toBeUndefined();
  });

  it("keeps the counters on the scope, so chips do not move the numbers", async () => {
    const container = await mount(
      <EncounterReportsBrowser tournamentId={7} workspaceId={4} canUpdateEncounter />
    );
    await waitFor(() => getEncounterReportStats.mock.calls.length > 0, "the stats request");

    const scope = getEncounterReportStats.mock.calls[0][0] as EncounterReportsQuery;
    expect(scope.workspace_id).toBe(4);
    expect(scope.tournament_id).toBe(7);
    // A counter narrowed by the current chip would report what is already on
    // screen instead of how much the scope still has to settle.
    expect(scope.result_status).toBeUndefined();
    expect(scope.mismatch_only).toBeUndefined();
    expect(scope.query).toBeUndefined();

    await click(button(container, "Disputed"));

    expect(getEncounterReportStats).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Reports disagree");
  });

  it("offers the resolve action on every row when the admin may settle results", async () => {
    const container = await mount(
      <EncounterReportsBrowser tournamentId={null} workspaceId={4} canUpdateEncounter />
    );
    await waitFor(() => bodyText(container).includes("Alpha vs Beta"), "the encounter row");

    // Visible outright, not revealed on hover: it is the one action this page exists for.
    expect(button(container.querySelector("tbody")!, "Resolve")).toBeTruthy();
  });

  it("labels an already confirmed result Review rather than Resolve", async () => {
    listEncounterReports.mockResolvedValue(
      pageOf([row({ result_status: "confirmed", scores_match: true })])
    );
    const container = await mount(
      <EncounterReportsBrowser tournamentId={null} workspaceId={4} canUpdateEncounter />
    );
    await waitFor(() => bodyText(container).includes("Alpha vs Beta"), "the encounter row");

    const tbody = container.querySelector("tbody")!;
    expect(button(tbody, "Review")).toBeTruthy();
    expect(button(tbody, "Resolve")).toBeUndefined();
  });

  it("withholds the write surface from an admin who may not update encounters", async () => {
    const container = await mount(
      <EncounterReportsBrowser
        tournamentId={null}
        workspaceId={4}
        canUpdateEncounter={false}
      />
    );
    await waitFor(() => bodyText(container).includes("Alpha vs Beta"), "the encounter row");

    const tbody = container.querySelector("tbody")!;
    expect(button(tbody, "Resolve")).toBeUndefined();
    // No row affordance either, or the row would advertise a dialog it cannot open.
    expect(dataRows(container)[0].getAttribute("tabindex")).toBeNull();
  });

  it("opens the resolve dialog for the clicked row", async () => {
    const container = await mount(
      <EncounterReportsBrowser tournamentId={null} workspaceId={4} canUpdateEncounter />
    );
    const first = await waitFor(
      () => (bodyText(container).includes("Alpha vs Beta") ? dataRows(container)[0] : null),
      "the first data row"
    );
    expect(container.querySelector('[data-testid="resolve"]')).toBeNull();

    await click(first);

    expect(container.querySelector('[data-testid="resolve"]')?.textContent).toBe("Alpha vs Beta");
  });

  it("asks for nothing until a workspace is chosen", async () => {
    const container = await mount(
      <EncounterReportsBrowser tournamentId={null} workspaceId={null} canUpdateEncounter />
    );

    expect(listEncounterReports).not.toHaveBeenCalled();
    expect(getEncounterReportStats).not.toHaveBeenCalled();
    expect(container.textContent).toContain("scoped to a workspace");
  });
});
