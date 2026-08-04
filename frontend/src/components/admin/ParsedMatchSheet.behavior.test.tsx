// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ParsedMatchSheet } from "@/components/admin/ParsedMatchSheet";
import type { AdminMatchRow, LogRecordRef } from "@/types/admin.types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getAdminMatch = vi.fn();

vi.mock("@/services/admin.service", () => ({
  default: { getAdminMatch: (...args: unknown[]) => getAdminMatch(...args) }
}));

async function mount(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={{}}>
        <QueryClientProvider client={client}>{node}</QueryClientProvider>
      </NextIntlClientProvider>
    );
  });
  for (let turn = 0; turn < 5; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  // Radix renders the sheet into a portal on document.body.
  return document.body;
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
    code: "ABC123",
    created_at: "2026-05-01T00:00:00Z",
    log_record: record(),
    ...overrides
  };
}

describe("ParsedMatchSheet", () => {
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

  it("calls an unlinked map unresolved, never failed", async () => {
    // Most of the archive predates the ingestion table. Presenting that as a
    // failure would bury the maps whose ingestion actually broke.
    const body = await mount(
      <ParsedMatchSheet row={row({ log_record: null })} workspaceId={1} open onOpenChange={() => {}} />
    );
    expect(body.textContent).toContain("Provenance unresolved");
    expect(body.textContent).not.toContain("failed");
  });

  it("still shows the log name when provenance is unresolved", async () => {
    // The S3 key is built from log_name, so the log stays downloadable even
    // with no record — the admin needs to see which file it is.
    const body = await mount(
      <ParsedMatchSheet row={row({ log_record: null })} workspaceId={1} open onOpenChange={() => {}} />
    );
    expect(body.textContent).toContain("Log-2026-04-20.txt");
  });

  it("names the record and its state when provenance resolves", async () => {
    const body = await mount(
      <ParsedMatchSheet row={row()} workspaceId={1} open onOpenChange={() => {}} />
    );
    expect(body.textContent).toContain("#77");
    expect(body.textContent).toContain("done");
    expect(body.textContent).not.toContain("Provenance unresolved");
  });

  it("surfaces the ingestion error verbatim", async () => {
    // A parser error is the one field an admin cannot reconstruct elsewhere.
    const body = await mount(
      <ParsedMatchSheet
        row={row({ log_record: record({ status: "failed", error_message: "log_not_found" }) })}
        workspaceId={1}
        open
        onOpenChange={() => {}}
      />
    );
    expect(body.textContent).toContain("log_not_found");
  });

  it("fetches the aggregates only once the sheet is open", async () => {
    await mount(
      <ParsedMatchSheet row={row()} workspaceId={1} open={false} onOpenChange={() => {}} />
    );
    expect(getAdminMatch).not.toHaveBeenCalled();

    await mount(<ParsedMatchSheet row={row()} workspaceId={1} open onOpenChange={() => {}} />);
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
    const body = await mount(
      <ParsedMatchSheet row={row()} workspaceId={1} open onOpenChange={() => {}} />
    );
    expect(body.textContent).toContain("No player statistics were written");
  });
});
