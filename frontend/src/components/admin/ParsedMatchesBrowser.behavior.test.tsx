// @vitest-environment happy-dom
import { act, useState, type ReactNode } from "react";
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

// The map chip's options come from the global map catalogue.
vi.mock("@/services/map.service", () => ({
  default: { lookup: (...args: unknown[]) => mapsLookup(...args) }
}));

vi.mock("@/services/tournament.service", () => ({
  default: { getAll: vi.fn().mockResolvedValue({ results: [], total: 0, page: 1, per_page: -1 }) }
}));

/**
 * `router.replace` in the app writes the URL and re-renders the tree from the
 * new `useSearchParams`. Here it writes `window.history` and pokes the harness,
 * so a chip written to the URL is read back exactly as it is in the browser.
 */
const replace = vi.fn((url: string) => {
  window.history.replaceState(null, "", url);
  rerender?.();
});

let rerender: (() => void) | null = null;

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/matches",
  useRouter: () => ({ replace, push: replace }),
  useSearchParams: () => new URLSearchParams(window.location.search)
}));

// The detail body has its own behaviour suite; here it only has to report
// whether the browser handed it a row.
vi.mock("@/components/admin/ParsedMatchDetail", () => ({
  ParsedMatchDetail: ({ row }: { row: AdminMatchRow }) => (
    <div data-testid="detail">{row.map_name}</div>
  )
}));

async function tick() {
  await act(async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 0);
    await promise;
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

/**
 * Renders through a factory, not a stored element: React bails out of
 * re-rendering a child whose element is referentially identical, so a
 * URL-driven re-render would never reach the browser under test.
 */
function Harness({ render }: Readonly<{ render: () => ReactNode }>) {
  const [, force] = useState(0);
  rerender = () => force((value) => value + 1);
  return <>{render()}</>;
}

async function mount(render: () => ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Harness render={render} />
      </QueryClientProvider>
    );
  });
  await tick();
  return container;
}

async function click(element: Element | null | undefined) {
  expect(element).toBeTruthy();
  await act(async () => {
    (element as HTMLElement).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    (element as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await tick();
}

function chipTrigger(scope: ParentNode) {
  return scope.querySelector<HTMLButtonElement>('button[aria-label="Add filter"]');
}

/** The chip popover portals out of the table, so options are document-wide. */
function commandItem(label: string) {
  return Array.from(document.querySelectorAll('[cmdk-item=""]')).find(
    (item) => item.textContent?.trim().startsWith(label)
  );
}

/** Open the "+ Filter" popover and pick `filter › option`. */
async function pickChip(scope: ParentNode, filter: string, option?: string) {
  await click(chipTrigger(scope));
  await click(await waitFor(() => commandItem(filter), `the ${filter} filter`));
  if (option) {
    await click(await waitFor(() => commandItem(option), `the ${option} option`));
  }
}

function activeChip(label: string) {
  return document.querySelector<HTMLButtonElement>(`button[aria-label="Remove filter ${label}"]`);
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
    replace.mockClear();
    window.history.replaceState(null, "", "/admin/matches");
    document.body.innerHTML = "";
  });

  it("renders each parsed map through the shared admin table", async () => {
    const container = await mount(() => <ParsedMatchesBrowser tournamentId={null} workspaceId={4} />);
    await waitFor(() => bodyText(container).includes("Ilios"), "the parsed map row");

    // The house browser, not a hand-rolled list: a real table with a toolbar.
    expect(container.querySelector("table")).toBeTruthy();
    const text = bodyText(container);
    expect(text).toContain("alpha-beta-ilios.txt");
    expect(text).toContain("Spring Cup");
    expect(text).toContain("2 – 1");
  });

  it("scopes the request to the workspace and pins the tournament when given", async () => {
    await mount(() => (
      <ParsedMatchesBrowser tournamentId={9} workspaceId={4} tournamentName="Spring Cup" />
    ));
    await waitFor(() => listAdminMatches.mock.calls.length > 0, "the list request");

    expect(lastQuery().workspace_id).toBe(4);
    expect(lastQuery().tournament_id).toBe(9);
    // Pinned: the hub owns the scope, so the chip carries no remove control.
    const pinned = document.querySelector('[data-pinned-filter="tournament"]');
    expect(pinned?.textContent).toContain("Spring Cup");
    expect(activeChip("Tournament: Spring Cup")).toBeNull();
  });

  it("maps the unresolved chip to the one filter a status cannot express", async () => {
    const container = await mount(() => <ParsedMatchesBrowser tournamentId={null} workspaceId={4} />);
    await waitFor(() => listAdminMatches.mock.calls.length > 0, "the list request");

    // `unlinked_only` is a second query param, so `log_status` cannot carry it.
    await pickChip(container, "Provenance unresolved");
    expect(lastQuery().unlinked_only).toBe(true);
    expect(lastQuery().log_status).toBeUndefined();
    // It is in the URL, so the narrowed list is linkable.
    expect(new URLSearchParams(window.location.search).get("unlinked_only")).toBe("1");

    await click(activeChip("Provenance unresolved"));
    expect(lastQuery().unlinked_only).toBeUndefined();
    expect(lastQuery().log_status).toBeUndefined();
  });

  it("sends a picked provenance status as the endpoint's log_status", async () => {
    const container = await mount(() => <ParsedMatchesBrowser tournamentId={null} workspaceId={4} />);
    await waitFor(() => listAdminMatches.mock.calls.length > 0, "the list request");

    await pickChip(container, "Ingestion status", "Failed");

    // All four statuses are reachable, and the one the endpoint repeats per
    // value stays a list.
    expect(lastQuery().log_status).toEqual(["failed"]);
    expect(lastQuery().unlinked_only).toBeUndefined();
    expect(new URLSearchParams(window.location.search).get("log_status")).toBe("failed");
  });

  it("sends a map picked from the catalogue as map_id", async () => {
    const container = await mount(() => <ParsedMatchesBrowser tournamentId={null} workspaceId={4} />);
    await waitFor(() => listAdminMatches.mock.calls.length > 0, "the list request");

    await pickChip(container, "Map", "Nepal");

    // The endpoint's free-text search covers log name, match code and team
    // names — never the map — so this filter is the only way to one map.
    expect(lastQuery().map_id).toBe(6);
  });

  it("returns to the first page when a chip narrows the result set", async () => {
    // Two pages' worth, so the pager renders and page 2 is reachable.
    listAdminMatches.mockResolvedValue(pageOf([row()], 60));
    const container = await mount(() => <ParsedMatchesBrowser tournamentId={null} workspaceId={4} />);
    const second = await waitFor(
      () => container.querySelector('[aria-label="Page 2"]'),
      "the second page button"
    );

    await click(second);
    expect(lastQuery().page).toBe(2);

    await pickChip(container, "Provenance unresolved");

    // Without the reset, a narrower filter lands on a page that no longer exists.
    expect(new URLSearchParams(window.location.search).get("page")).toBeNull();
  });

  it("calls an unlinked map unresolved, never failed", async () => {
    listAdminMatches.mockResolvedValue(pageOf([row({ log_record: null })]));
    const container = await mount(() => <ParsedMatchesBrowser tournamentId={null} workspaceId={4} />);
    await waitFor(() => bodyText(container).includes("Ilios"), "the parsed map row");

    // Scoped to the rows: "Failed" is also a chip option label.
    expect(bodyText(container)).toContain("unresolved");
    expect(bodyText(container)).not.toContain("failed");
  });

  it("opens the inspector for the clicked row and records it in the URL", async () => {
    const container = await mount(() => <ParsedMatchesBrowser tournamentId={null} workspaceId={4} />);
    const first = await waitFor(() => dataRows(container)[0], "the first data row");
    expect(container.querySelector('[data-testid="detail"]')).toBeNull();

    await click(first);

    expect(new URLSearchParams(window.location.search).get("id")).toBe("1");
    expect(container.querySelector('[data-testid="detail"]')?.textContent).toBe("Ilios");
  });

  it("restores the open row from ?id= on load", async () => {
    window.history.replaceState(null, "", "/admin/matches?id=1");
    const container = await mount(() => <ParsedMatchesBrowser tournamentId={null} workspaceId={4} />);

    // The inspector is the row detail surface, so a deep link opens it.
    const detail = await waitFor(
      () => container.querySelector('[data-testid="detail"]'),
      "the restored inspector"
    );
    expect(detail?.textContent).toBe("Ilios");
  });

  it("asks for nothing until a workspace is chosen", async () => {
    const container = await mount(() => <ParsedMatchesBrowser tournamentId={null} workspaceId={null} />);

    expect(listAdminMatches).not.toHaveBeenCalled();
    expect(container.textContent).toContain("scoped to a workspace");
  });
});
