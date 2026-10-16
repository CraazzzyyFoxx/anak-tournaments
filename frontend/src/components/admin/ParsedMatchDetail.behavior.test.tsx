// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ParsedMatchDetail } from "@/components/admin/ParsedMatchDetail";
import type { AdminMatchRow, LogRecordRef } from "@/types/admin.types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getAdminMatch = vi.fn();

vi.mock("@/services/admin.service", () => ({
  default: { getAdminMatch: (...args: unknown[]) => getAdminMatch(...args) }
}));
vi.mock("@/lib/datetime/client", () => ({
  useFormatter: () => ({ dateTime: (value: Date) => value.toISOString() })
}));

async function mount(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(container);
  await act(async () => {
    root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  });
  for (let turn = 0; turn < 5; turn += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
  return container;
}

function record(overrides: Partial<LogRecordRef> = {}): LogRecordRef {
  return {
    id: 77,
    filename: "Log-2026-04-20.txt",
    status: "done",
    source: "upload",
    uploader_id: 5,
    attempts: 1,
    error_message: null,
    created_at: "2026-04-20T00:00:00Z",
    started_at: "2026-04-20T00:00:01Z",
    finished_at: "2026-04-20T00:00:09Z",
    ...overrides
  };
}

function row(overrides: Partial<AdminMatchRow> = {}): AdminMatchRow {
  return {
    id: 100,
    encounter_id: 10,
    encounter_name: "A vs B",
    tournament_id: 3,
    tournament_name: "Cup",
    map_id: 8,
    map_name: "Ilios",
    home_team: { id: 1, name: "A" },
    away_team: { id: 2, name: "B" },
    home_score: 2,
    away_score: 1,
    time: 612.5,
    log_name: "Log-2026-04-20.txt",
    created_at: "2026-05-01T00:00:00Z",
    log_record: record(),
    ...overrides
  };
}

describe("ParsedMatchDetail", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    getAdminMatch.mockReset().mockResolvedValue({
      ...row(),
      rounds: 3,
      statistics_count: 120,
      kill_feed_count: 88,
      event_count: 40
    });
  });

  it.each([
    { time: null, duration: "—" },
    { time: 0, duration: "0m 00s" }
  ])("preserves statistics with unavailable raw logs and duration $time", async ({ time, duration }) => {
    const scope = await mount(
      <ParsedMatchDetail row={row({ time, log_name: null, log_record: null })} workspaceId={1} />
    );
    const durationLabel = Array.from(scope.querySelectorAll("p")).find(
      (element) => element.textContent === "Duration"
    );
    expect(durationLabel?.nextElementSibling?.textContent).toBe(duration);
    expect(scope.textContent).toContain("A 2 – 1 B");
    expect(scope.textContent).toContain("120");
    expect(scope.textContent).toContain("88");
    expect(scope.textContent).toContain("40");
  });

  it("names the record and its state when provenance resolves", async () => {
    const scope = await mount(<ParsedMatchDetail row={row()} workspaceId={1} />);
    expect(scope.textContent).toContain("#77");
    expect(scope.textContent).toContain("done");
  });

  it("keeps an awaiting-link job distinct from success and failure", async () => {
    const scope = await mount(
      <ParsedMatchDetail
        row={row({ log_record: record({ status: "awaiting_link", source: "desktop_agent" }) })}
        workspaceId={1}
      />
    );
    expect(scope.textContent).toContain("awaiting_link");
    expect(scope.textContent).toContain("#77");
    expect(scope.textContent).toContain("desktop_agent");
    expect(scope.textContent).not.toContain("done");
    expect(scope.textContent).not.toContain("failed");
  });

  it("keeps historical scores and job details when team references and filename are absent", async () => {
    const scope = await mount(
      <ParsedMatchDetail
        row={row({ home_team: null, away_team: null, log_record: record({ filename: null }) })}
        workspaceId={1}
      />
    );
    expect(scope.textContent).toContain("? 2 – 1 ?");
    expect(scope.textContent).toContain("#77");
    expect(scope.textContent).toContain("done");
    expect(scope.textContent).toContain("120");
  });

  it("surfaces the ingestion error verbatim", async () => {
    // A parser error is the one field an admin cannot reconstruct elsewhere.
    const scope = await mount(
      <ParsedMatchDetail
        row={row({ log_record: record({ status: "failed", error_message: "log_not_found" }) })}
        workspaceId={1}
      />
    );
    expect(scope.textContent).toContain("log_not_found");
  });

  it("fetches the aggregates for the open row, and only with a workspace", async () => {
    // The inspector mounts this only while a row is open, so "open" is no
    // longer a prop — but the aggregates must still be scoped to a workspace,
    // never requested without one.
    await mount(<ParsedMatchDetail row={row()} workspaceId={null} />);
    expect(getAdminMatch).not.toHaveBeenCalled();

    await mount(<ParsedMatchDetail row={row()} workspaceId={1} />);
    expect(getAdminMatch).toHaveBeenCalledWith(100, 1);
  });

  it("warns when a map parsed no player statistics", async () => {
    // An accepted log that produced nothing still counts the map as played, so
    // the emptiness has to be visible rather than read as a loading state.
    getAdminMatch.mockResolvedValue({
      ...row(),
      rounds: 0,
      statistics_count: 0,
      kill_feed_count: 0,
      event_count: 0
    });
    const scope = await mount(<ParsedMatchDetail row={row()} workspaceId={1} />);
    expect(scope.textContent).toContain("No player statistics were written");
  });
});
