// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ParsedMatchesBrowser } from "@/components/admin/ParsedMatchesBrowser";
import type { AdminMatchRow, AdminMatchesQuery, LogRecordRef } from "@/types/admin.types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const listAdminMatches = vi.fn();
const mapsLookup = vi.fn();

vi.mock("@/services/admin.service", () => ({
  default: {
    listAdminMatches: (...args: unknown[]) => listAdminMatches(...args),
    getAdminMatch: vi.fn()
  }
}));

// The map header filter's options come from the global map catalogue.
vi.mock("@/services/map.service", () => ({
  default: { lookup: (...args: unknown[]) => mapsLookup(...args) }
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/admin/matches" }));

// The sheet has its own behaviour suite; here it only has to report whether the
// browser opened it, so the stub keeps Radix's portal out of the assertions.
vi.mock("@/components/admin/ParsedMatchSheet", () => ({
  ParsedMatchSheet: ({ open, row }: { open: boolean; row: AdminMatchRow | null }) =>
    open ? <div data-testid="sheet">{row?.map_name}</div> : null
}));

async function tick() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * React Query settles across both microtasks and timers, and the first mount in
 * a file also pays for loading the table. Polling beats a fixed number of turns:
 * a fixed count passed only once the module cache was already warm.
 */
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

function funnel(scope: ParentNode, label: string) {
  return scope.querySelector<HTMLButtonElement>(`button[aria-label^="${label}"]`);
}

/** The popover portals out of the table, so its options are looked up document-wide. */
function option(label: string) {
  return Array.from(document.querySelectorAll('[cmdk-item=""]')).find(
    (item) => item.textContent?.trim() === label
  );
}

/** Only real rows carry `tabindex`; the empty-state row does not. */
function dataRows(scope: ParentNode) {
  return Array.from(scope.querySelectorAll("tbody tr[tabindex]"));
}

function bodyText(scope: ParentNode) {
  return scope.querySelector("tbody")?.textContent ?? "";
}

function lastQuery(): AdminMatchesQuery {
  return listAdminMatches.mock.calls.at(-1)![0] as AdminMatchesQuery;
}

function record(overrides: Partial<LogRecordRef> = {}): LogRecordRef {
  return {
    id: 7,
    filename: "mtchlog001.txt",
    status: "done",
    source: "upload",
    uploader_id: 1,
    attempts: 1,
    error_message: null,
    created_at: "2026-01-01T00:00:00Z",
    started_at: null,
    finished_at: null,
    ...overrides
  };
}

function row(overrides: Partial<AdminMatchRow> = {}): AdminMatchRow {
  return {
    id: 1,
    encounter_id: 11,
    encounter_name: "Alpha vs Beta",
    tournament_id: 3,
    tournament_name: "Spring Cup",
    map_id: 5,
    map_name: "Ilios",
    home_team: { id: 1, name: "Alpha" },
    away_team: { id: 2, name: "Beta" },
    home_score: 2,
    away_score: 1,
    time: 600,
    log_name: "alpha-beta-ilios.txt",
    code: "ABC123",
    created_at: "2026-01-01T00:00:00Z",
    log_record: record(),
    ...overrides
  };
}

function pageOf(results: AdminMatchRow[], total = results.length) {
  return { results, total, page: 1, per_page: 25 };
}

describe("ParsedMatchesBrowser", () => {
  beforeEach(() => {
    listAdminMatches.mockReset();
    listAdminMatches.mockResolvedValue(pageOf([row()]));
    mapsLookup.mockReset();
    mapsLookup.mockResolvedValue([
      { id: 5, name: "Ilios" },
      { id: 6, name: "Nepal" }
    ]);
    window.history.replaceState(null, "", "/admin/matches");
    document.body.innerHTML = "";
  });

  it("renders each parsed map through the shared admin table", async () => {
    const container = await mount(<ParsedMatchesBrowser tournamentId={null} workspaceId={4} />);
    await waitFor(() => bodyText(container).includes("Ilios"), "the parsed map row");

    // The house browser, not a hand-rolled list: a real table with a toolbar.
    expect(container.querySelector("table")).toBeTruthy();
    const text = bodyText(container);
    expect(text).toContain("alpha-beta-ilios.txt");
    expect(text).toContain("Spring Cup");
    expect(text).toContain("2 – 1");
  });

  it("scopes the request to the workspace and pins the tournament when given", async () => {
    await mount(<ParsedMatchesBrowser tournamentId={9} workspaceId={4} />);
    await waitFor(() => listAdminMatches.mock.calls.length > 0, "the list request");

    expect(lastQuery().workspace_id).toBe(4);
    expect(lastQuery().tournament_id).toBe(9);
  });

  it("maps the toolbar chip to the one filter the header cannot carry", async () => {
    const container = await mount(<ParsedMatchesBrowser tournamentId={null} workspaceId={4} />);
    await waitFor(() => listAdminMatches.mock.calls.length > 0, "the list request");

    // `unlinked_only` is a second query param, and one column filter carries
    // one param, so the provenance column's `log_status` cannot express it.
    await click(button(container, "Provenance unresolved"));
    expect(lastQuery().unlinked_only).toBe(true);
    expect(lastQuery().log_status).toBeUndefined();

    await click(button(container, "All"));
    expect(lastQuery().unlinked_only).toBeUndefined();
    expect(lastQuery().log_status).toBeUndefined();
  });

  it("sends a checked provenance status as the endpoint's log_status", async () => {
    const container = await mount(<ParsedMatchesBrowser tournamentId={null} workspaceId={4} />);
    await waitFor(() => listAdminMatches.mock.calls.length > 0, "the list request");

    await click(funnel(container, "Filter by ingestion status"));
    await click(await waitFor(() => option("Failed"), "the Failed option"));

    // The chip that used to be the only way here is gone: the column that
    // prints the status owns filtering by it, and all four are now reachable.
    expect(lastQuery().log_status).toEqual(["failed"]);
    expect(lastQuery().unlinked_only).toBeUndefined();
    expect(new URLSearchParams(window.location.search).getAll("log_status")).toEqual(["failed"]);
  });

  it("sends a map picked from the catalogue as map_id", async () => {
    const container = await mount(<ParsedMatchesBrowser tournamentId={null} workspaceId={4} />);
    await waitFor(() => listAdminMatches.mock.calls.length > 0, "the list request");

    await click(funnel(container, "Filter by map"));
    await click(await waitFor(() => option("Nepal"), "the Nepal option"));

    // The endpoint's free-text search covers log name, match code and team
    // names — never the map — so this filter is the only way to one map.
    expect(lastQuery().map_id).toBe(6);
  });

  it("exposes the selected chip to assistive tech as a pressed grouped button", async () => {
    const container = await mount(<ParsedMatchesBrowser tournamentId={null} workspaceId={4} />);

    const group = container.querySelector('[role="group"]');
    expect(group?.getAttribute("aria-label")).toBe("Filter parsed matches");
    expect(button(container, "All")?.getAttribute("aria-pressed")).toBe("true");

    await click(button(container, "Provenance unresolved"));

    expect(button(container, "Provenance unresolved")?.getAttribute("aria-pressed")).toBe("true");
    expect(button(container, "All")?.getAttribute("aria-pressed")).toBe("false");
  });

  it("returns to the first page when a chip narrows the result set", async () => {
    // Two pages' worth, so the pager renders and page 2 is reachable.
    listAdminMatches.mockResolvedValue(pageOf([row()], 60));
    const container = await mount(<ParsedMatchesBrowser tournamentId={null} workspaceId={4} />);
    const second = await waitFor(
      () => container.querySelector('[aria-label="Page 2"]'),
      "the second page button"
    );

    await click(second);
    expect(lastQuery().page).toBe(2);

    await click(button(container, "Provenance unresolved"));

    // Without the reset, a narrower filter lands on a page that no longer exists.
    expect(lastQuery().page).toBe(1);
  });

  it("calls an unlinked map unresolved, never failed", async () => {
    listAdminMatches.mockResolvedValue(pageOf([row({ log_record: null })]));
    const container = await mount(<ParsedMatchesBrowser tournamentId={null} workspaceId={4} />);
    await waitFor(() => bodyText(container).includes("Ilios"), "the parsed map row");

    // Scoped to the rows: "Failed" is also a header-filter option label.
    expect(bodyText(container)).toContain("unresolved");
    expect(bodyText(container)).not.toContain("failed");
  });

  it("opens the detail sheet for the clicked row", async () => {
    const container = await mount(<ParsedMatchesBrowser tournamentId={null} workspaceId={4} />);
    const first = await waitFor(() => dataRows(container)[0], "the first data row");
    expect(container.querySelector('[data-testid="sheet"]')).toBeNull();

    await click(first);

    expect(container.querySelector('[data-testid="sheet"]')?.textContent).toBe("Ilios");
  });

  it("asks for nothing until a workspace is chosen", async () => {
    const container = await mount(<ParsedMatchesBrowser tournamentId={null} workspaceId={null} />);

    expect(listAdminMatches).not.toHaveBeenCalled();
    expect(container.textContent).toContain("scoped to a workspace");
  });
});
