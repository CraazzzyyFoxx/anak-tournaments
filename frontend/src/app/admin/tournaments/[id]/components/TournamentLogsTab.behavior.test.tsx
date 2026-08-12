// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  LogHistoryResponse,
  LogProcessingRecord,
  LogProcessingStats
} from "@/types/admin.types";
import { TournamentLogsTab } from "./TournamentLogsTab";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getLogStats = vi.fn();
const getLogHistory = vi.fn();

vi.mock("@/services/admin.service", () => ({
  default: {
    getLogStats: (...args: unknown[]) => getLogStats(...args),
    getLogHistory: (...args: unknown[]) => getLogHistory(...args),
    retryLogRecord: vi.fn(),
    processAllTournamentLogs: vi.fn()
  }
}));
vi.mock("@/hooks/useRealtimeTopic", () => ({ useRealtimeTopic: () => {} }));
vi.mock("@/lib/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn(), apiError: vi.fn() }
}));

const STATS: LogProcessingStats = {
  total: 128,
  pending: 4,
  processing: 1,
  done: 120,
  failed: 3,
  avg_duration_seconds: 4.25,
  last_created_at: "2026-07-30T17:04:00Z"
};

function record(id: number, overrides: Partial<LogProcessingRecord> = {}): LogProcessingRecord {
  return {
    id,
    tournament_id: 78,
    tournament_name: "OWT 78",
    attached_encounter_id: null,
    attached_encounter_name: null,
    filename: `logs/round_${id}.txt`,
    status: "done",
    source: "upload",
    uploader_name: "operator",
    error_message: null,
    attempts: 1,
    created_at: "2026-07-30T17:00:00Z",
    started_at: "2026-07-30T17:00:00Z",
    finished_at: "2026-07-30T17:00:04Z",
    ...overrides
  };
}

/** A full page (the console requests 25) so paging behaves as it does in production. */
const FIRST_PAGE: LogHistoryResponse = {
  items: [
    record(1, { status: "failed", error_message: "502: gateway timeout" }),
    record(99, { status: "pending", attempts: 3, started_at: null, finished_at: null }),
    ...Array.from({ length: 23 }, (_unused, index) => record(index + 2))
  ],
  total: 128
};

async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <TournamentLogsTab
          tournamentId={78}
          workspaceId={1}
          encounters={[]}
          canUploadLogs={false}
          enabled
        />
      </QueryClientProvider>
    );
  });
  // React Query resolves through both microtasks and timers before committing.
  for (let turn = 0; turn < 5; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  return container;
}

beforeEach(() => {
  getLogStats.mockReset().mockResolvedValue(STATS);
  getLogHistory.mockReset().mockResolvedValue(FIRST_PAGE);
});

describe("TournamentLogsTab", () => {
  it("labels each status filter with the scope-wide count, not the loaded rows", async () => {
    const scope = await mount();

    // Two rows are loaded, yet every count describes all 128 records.
    const filters = [...scope.querySelectorAll("[role='radio']")]
      .map((node) => node.textContent)
      .join("|");

    expect(filters).toContain("All128");
    expect(filters).toContain("Failed3");
    expect(filters).toContain("Queued4");
    expect(getLogStats).toHaveBeenCalledWith(78);
  });

  it("asks the server for the first page, filters included", async () => {
    await mount();

    expect(getLogHistory).toHaveBeenCalledWith(78, {
      limit: 25,
      offset: 0,
      status: undefined,
      search: ""
    });
  });

  it("reports loaded-vs-matched progress and offers the next page", async () => {
    const scope = await mount();

    const statuses = [...scope.querySelectorAll("[role='status']")].map((node) => node.textContent);
    expect(statuses).toContain("Showing 25 of 128 logs");
    expect(scope.textContent).toContain("Load more logs");
  });

  it("names the failure and scopes the bulk retry to what is loaded", async () => {
    const scope = await mount();

    expect(scope.textContent).toContain("gateway timeout");
    expect(scope.textContent).toContain("Retry 1 loaded");
  });

  it("offers a requeue for a queued row the worker dropped", async () => {
    const scope = await mount();

    // "Queued" rows used to have no control at all: only `failed` got a button,
    // so a log whose queue message expired was stuck with no way out.
    const labels = [...scope.querySelectorAll("button[aria-label]")].map((node) =>
      node.getAttribute("aria-label")
    );
    expect(labels).toContain("Requeue log round_99.txt");
    expect(labels).toContain("Retry log round_1.txt");
    // Attempt count surfaces the requeue loop on the row itself.
    expect(scope.textContent).toContain("×3");
  });

  it("points forward when the tournament has no logs at all", async () => {
    getLogHistory.mockResolvedValue({ items: [], total: 0 });
    getLogStats.mockResolvedValue({
      ...STATS,
      total: 0,
      pending: 0,
      processing: 0,
      done: 0,
      failed: 0
    });

    const scope = await mount();

    expect(scope.textContent).toContain("No logs for this tournament yet");
    expect(scope.textContent).not.toContain("Clear filters");
  });
});
