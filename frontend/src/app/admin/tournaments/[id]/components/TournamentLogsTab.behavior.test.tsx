// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useEffect, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  LogHistoryResponse,
  LogProcessingRecord,
  LogProcessingStats
} from "@/types/admin.types";
import type { Encounter } from "@/types/encounter.types";
import { notify } from "@/lib/notify";
import { TournamentLogsTab } from "./TournamentLogsTab";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getLogStats = vi.fn();
const getLogHistory = vi.fn();
const retryLogRecord = vi.fn();
const getEncounter = vi.fn();

vi.mock("@/services/encounter.service", () => ({
  default: { getEncounter: (...args: unknown[]) => getEncounter(...args) }
}));

vi.mock("@/services/admin.service", () => ({
  default: {
    getLogStats: (...args: unknown[]) => getLogStats(...args),
    getLogHistory: (...args: unknown[]) => getLogHistory(...args),
    retryLogRecord: (...args: unknown[]) => retryLogRecord(...args),
    processAllTournamentLogs: vi.fn()
  }
}));
vi.mock("@/hooks/useRealtimeTopic", () => ({ useRealtimeTopic: () => {} }));
vi.mock("@/lib/datetime/client", () => ({
  useFormatter: () => ({ dateTime: (value: Date) => value.toISOString() })
}));
vi.mock("@/lib/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn(), apiError: vi.fn() }
}));

/** The status chip lives in the URL now, so the console needs a router. */
const replace = vi.fn((url: string) => {
  window.history.replaceState(null, "", url);
  rerender?.();
});

let rerender: (() => void) | null = null;

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/tournaments/78/matches/logs",
  useRouter: () => ({ replace, push: replace }),
  useSearchParams: () => new URLSearchParams(window.location.search)
}));

const STATS: LogProcessingStats = {
  total: 128,
  pending: 4,
  processing: 1,
  done: 120,
  failed: 3,
  awaiting_link: 0,
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
    attached_encounter_game_id: null,
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

const PLAYOFF = {
  id: 6662,
  name: "Home vs Away",
  tournament_id: 78,
  round: -3,
  stage: { name: "Playoffs" },
  stage_item: null
} as Encounter;

function game(id: number, position: number, state: Encounter["games"][number]["state"] = "planned"): Encounter["games"][number] {
  return {
    id,
    position,
    map_id: 21,
    map: { id: 21, name: "Ilios" } as Encounter["games"][number]["map"],
    state,
    result_source: null,
    result_version: 0,
    confirmed_at: null,
    teams: []
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

// Roots are tracked so afterEach can tear them down. Without it React 19 leaves a
// scheduler callback queued past the end of the file, and when vitest disposes the
// happy-dom environment that callback dereferences `window` — an unhandled
// `ReferenceError: window is not defined` that fails the whole run while every
// test still reports green. It only shows up under CI timing, which is why it
// surfaced the first time this suite ran there.
const mounted: { root: Root; container: HTMLElement }[] = [];

async function settle(turns = 5) {
  for (let turn = 0; turn < turns; turn += 1) {
    await act(async () => {
      if (vi.isFakeTimers()) {
        await vi.advanceTimersByTimeAsync(0);
      } else {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 0);
        await promise;
      }
    });
  }
}

/**
 * Renders through a factory: React bails out of re-rendering a child whose
 * element is referentially identical, so a URL-driven re-render would never
 * reach the console under test.
 */
function Harness({ render }: Readonly<{ render: () => ReactNode }>) {
  const [, force] = useState(0);
  // Published from an effect, not during render: writing a module-scope binding
  // while rendering is a side effect the react-compiler rules reject.
  useEffect(() => {
    rerender = () => force((value) => value + 1);
  }, []);
  return <>{render()}</>;
}

async function mount(tournamentId: number | null = 78, encounters: Encounter[] = []) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Harness
          render={() => (
            <TournamentLogsTab
              tournamentId={tournamentId}
              workspaceId={1}
              encounters={encounters}
              canUploadLogs={false}
            />
          )}
        />
      </QueryClientProvider>
    );
  });
  await settle();
  return container;
}

async function click(element: Element | null | undefined) {
  expect(element).toBeTruthy();
  await act(async () => {
    (element as HTMLElement).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    element!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle(2);
}

function button(scope: ParentNode, text: string) {
  return Array.from(scope.querySelectorAll("button")).find(
    (element) => element.textContent?.trim() === text
  );
}

function commandItem(label: string) {
  return Array.from(document.querySelectorAll('[cmdk-item=""]')).find(
    (item) => item.textContent?.trim().startsWith(label)
  );
}

function menuItem(label: string) {
  return Array.from(document.querySelectorAll("[role='menuitem']")).find(
    (item) => item.textContent?.trim() === label
  );
}

beforeEach(() => {
  getLogStats.mockReset().mockResolvedValue(STATS);
  getLogHistory.mockReset().mockResolvedValue(FIRST_PAGE);
  replace.mockClear();
  retryLogRecord.mockReset().mockResolvedValue(record(1, { status: "pending" }));
  getEncounter.mockReset().mockResolvedValue({
    ...PLAYOFF,
    games: [game(801, 1), game(907, 2), game(999, 3, "cancelled")]
  });
  vi.mocked(notify.success).mockClear();
  vi.mocked(notify.apiError).mockClear();
  window.history.replaceState(null, "", "/admin/tournaments/78/matches/logs");
});

afterEach(async () => {
  await act(async () => {
    for (const { root, container } of mounted.splice(0)) {
      root.unmount();
      container.remove();
    }
  });
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("TournamentLogsTab", () => {
  it("labels each status option with the scope-wide count, not the loaded rows", async () => {
    const scope = await mount();

    // Two interesting rows are loaded, yet every count describes all 128
    // records — the aggregate, not the page.
    await click(scope.querySelector('button[aria-label="Add filter"]'));
    await click(commandItem("Status"));

    const options = Array.from(document.querySelectorAll('[cmdk-item=""]'))
      .map((node) => node.textContent)
      .join("|");
    expect(options).toContain("Failed3");
    expect(options).toContain("Queued4");
    expect(scope.textContent).toContain("128 logs");
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

  it("puts the picked status in the URL and sends it to the server", async () => {
    // The old toggle group kept this in component state, so "show me the
    // failures" could not be linked to anyone.
    const scope = await mount();

    await click(button(scope, "Show failed"));

    expect(new URLSearchParams(window.location.search).get("status")).toBe("failed");
    await settle();
    expect(getLogHistory).toHaveBeenLastCalledWith(78, {
      limit: 25,
      offset: 0,
      status: "failed",
      search: ""
    });
  });

  it("restores the status from the URL on load", async () => {
    window.history.replaceState(null, "", "/admin/tournaments/78/matches/logs?status=failed");
    await mount();

    expect(getLogHistory).toHaveBeenCalledWith(78, {
      limit: 25,
      offset: 0,
      status: "failed",
      search: ""
    });
  });

  it("reads the workspace when no tournament scopes it", async () => {
    // The same console backs `/admin/matches?view=logs`, where there is no
    // tournament to scope by — both endpoints take the workspace instead.
    await mount(null);

    expect(getLogStats).toHaveBeenCalledWith(undefined, { workspaceId: 1 });
    expect(getLogHistory).toHaveBeenCalledWith(undefined, {
      limit: 25,
      offset: 0,
      status: undefined,
      search: "",
      workspaceId: 1
    });
  });

  it("pages through the server by offset", async () => {
    const scope = await mount();

    expect(scope.textContent).toContain("1–25 of 128");
    await click(scope.querySelector('button[aria-label="Next page"]'));
    await settle();

    expect(getLogHistory).toHaveBeenLastCalledWith(78, {
      limit: 25,
      offset: 25,
      status: undefined,
      search: ""
    });
  });

  it("names the failure and bulk-retries only rows that are not done", async () => {
    const scope = await mount();

    expect(scope.textContent).toContain("gateway timeout");
    // A processed log has nothing to retry, so it cannot join the selection.
    expect(scope.querySelector('button[aria-label="Select row 2"]')).toBeNull();

    await click(scope.querySelector('button[aria-label="Select row 1"]'));
    await click(scope.querySelector('button[aria-label="Select row 99"]'));
    expect(button(scope, "Retry 2")).toBeTruthy();
  });

  it("offers a requeue for a queued row the worker dropped", async () => {
    const scope = await mount();

    // "Queued" rows used to have no control at all: only `failed` got a button,
    // so a log whose queue message expired was stuck with no way out.
    const labels = [...scope.querySelectorAll("button[aria-label]")].map((node) =>
      node.getAttribute("aria-label")
    );
    expect(labels).toContain("Actions for round_99.txt");
    expect(labels).toContain("Actions for round_1.txt");
    expect(labels).not.toContain("Actions for round_2.txt");
    // Attempt count surfaces the requeue loop on the row itself.
    expect(scope.textContent).toContain("×3");
  });

  it("does not offer retry or attachment while the job is processing", async () => {
    getLogHistory.mockResolvedValue({ items: [record(17, { status: "processing" })], total: 1 });
    const scope = await mount(78, [PLAYOFF]);
    expect(scope.textContent).toContain("Processing");
    expect(scope.querySelector('button[aria-label="Select row 17"]')).toBeNull();
    expect(scope.querySelector('button[aria-label="Actions for round_17.txt"]')).toBeNull();
  });

  it("requires an actual noncancelled game when resolving two live games on the same map", async () => {
    getLogHistory.mockResolvedValue({
      items: [record(17, { status: "awaiting_link", tournament_id: null, tournament_name: null })],
      total: 1
    });
    const scope = await mount(78, [PLAYOFF]);

    await click(scope.querySelector('button[aria-label="Actions for round_17.txt"]'));
    await click(menuItem("Attach to encounter…"));
    await click(document.querySelector('button[aria-label="Pick an encounter"]'));
    await click(commandItem("Home vs Away · Playoffs · LB Round 3"));
    expect(button(document, "Attach and reprocess")?.disabled).toBe(true);
    await click(document.querySelector('button[aria-label="Pick a game"]'));
    expect(commandItem("Game 3")).toBeUndefined();
    await click(commandItem("Game 2 · Ilios · #907"));
    await click(button(document, "Attach and reprocess"));

    expect(retryLogRecord).toHaveBeenCalledWith(17, {
      encounter_id: 6662,
      encounter_game_id: 907
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(notify.success).toHaveBeenCalledWith("Log attached and queued");
  });

  it("renders and filters awaiting-link jobs with null tournament hints and native source kinds", async () => {
    getLogStats.mockResolvedValue({ ...STATS, awaiting_link: 9 });
    getLogHistory.mockResolvedValue({
      items: [record(17, {
        status: "awaiting_link",
        tournament_id: null,
        tournament_name: null,
        source: "desktop_agent"
      })],
      total: 1
    });
    const scope = await mount(null);
    expect(scope.textContent).toContain("Awaiting link");
    expect(scope.textContent).toContain("Not attached");
    expect(scope.querySelector('[title*="desktop_agent"]')).not.toBeNull();
    await click(scope.querySelector('button[aria-label="Add filter"]'));
    await click(commandItem("Status"));
    expect(commandItem("Awaiting link")?.textContent).toContain("9");
    await click(commandItem("Awaiting link"));
    expect(new URLSearchParams(window.location.search).get("status")).toBe("awaiting_link");
    expect(getLogHistory).toHaveBeenLastCalledWith(undefined, expect.objectContaining({
      status: "awaiting_link", workspaceId: 1
    }));
  });

  it("does not poll an awaiting-only queue or present it as failed or processed", async () => {
    vi.useFakeTimers();
    getLogStats.mockResolvedValue({
      ...STATS, total: 1, pending: 0, processing: 0, failed: 0, done: 0, awaiting_link: 1
    });
    getLogHistory.mockResolvedValue({ items: [record(17, { status: "awaiting_link" })], total: 1 });
    const scope = await mount();
    const reads = getLogHistory.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(getLogHistory).toHaveBeenCalledTimes(reads);
    expect(scope.textContent).toContain("Awaiting link");
    expect(scope.textContent).not.toContain("Processed");
    expect(scope.textContent).not.toContain("failed to process");
  });

  it("clears the selected game when the encounter changes", async () => {
    const scope = await mount(78, [PLAYOFF, { ...PLAYOFF, id: 6663, name: "Other teams" }]);
    await click(scope.querySelector('button[aria-label="Actions for round_1.txt"]'));
    await click(menuItem("Attach to encounter…"));
    await click(document.querySelector('button[aria-label="Pick an encounter"]'));
    await click(commandItem("Home vs Away"));
    await click(document.querySelector('button[aria-label="Pick a game"]'));
    await click(commandItem("Game 2 · Ilios · #907"));
    expect(button(document, "Attach and reprocess")?.disabled).toBe(false);
    getEncounter.mockResolvedValue({ ...PLAYOFF, id: 6663, games: [game(1201, 1)] });
    await click(document.querySelector('button[aria-label="Pick an encounter"]'));
    await click(commandItem("Other teams"));
    expect(button(document, "Attach and reprocess")?.disabled).toBe(true);
    expect(retryLogRecord).not.toHaveBeenCalled();
  });

  it("keeps attachment pending and preserves the dialog and selection when the server rejects it", async () => {
    const retry = Promise.withResolvers<LogProcessingRecord>();
    retryLogRecord.mockReturnValue(retry.promise);
    const scope = await mount(78, [PLAYOFF]);
    await click(scope.querySelector('button[aria-label="Actions for round_1.txt"]'));
    await click(menuItem("Attach to encounter…"));
    await click(document.querySelector('button[aria-label="Pick an encounter"]'));
    await click(commandItem("Home vs Away"));
    await click(document.querySelector('button[aria-label="Pick a game"]'));
    await click(commandItem("Game 2 · Ilios · #907"));
    await click(button(document, "Attach and reprocess"));
    expect(button(document, "Attach and reprocess")?.disabled).toBe(true);
    expect(notify.success).not.toHaveBeenCalled();
    const error = new Error("This game cannot be rebound");
    await act(async () => { retry.reject(error); });
    await settle();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Game 2 · Ilios · #907");
    expect(button(document, "Attach and reprocess")?.disabled).toBe(false);
    expect(notify.apiError).toHaveBeenCalledWith(error);
    expect(notify.success).not.toHaveBeenCalled();
  });

  it("blocks attachment when games cannot be loaded or only cancelled games remain", async () => {
    getEncounter.mockRejectedValue(new Error("Forbidden"));
    const scope = await mount(78, [PLAYOFF]);
    await click(scope.querySelector('button[aria-label="Actions for round_1.txt"]'));
    await click(menuItem("Attach to encounter…"));
    await click(document.querySelector('button[aria-label="Pick an encounter"]'));
    await click(commandItem("Home vs Away"));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Could not load games");
    expect(button(document, "Attach and reprocess")?.disabled).toBe(true);
    getEncounter.mockResolvedValue({ ...PLAYOFF, games: [game(999, 1, "cancelled")] });
    await click(button(document, "Reload games"));
    expect(document.body.textContent).toContain("No noncancelled games");
    expect(button(document, "Attach and reprocess")?.disabled).toBe(true);
    expect(retryLogRecord).not.toHaveBeenCalled();
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
