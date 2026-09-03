// @vitest-environment happy-dom
//
// Registration › Sheets feed. What is pinned here:
//   1. the save affordance is the shared `SaveBar`: absent while clean, so a
//      tournament with no feed does not carry a permanently disabled button;
//   2. the first edit of the URL is what makes "Create feed" appear — the same
//      moment a save could first succeed;
//   3. Discard puts the source fields back to the saved feed and hides the bar.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminGoogleSheetFeed, MappingCatalog } from "@/types/balancer-admin.types";
import SheetsFeedPage from "./SheetsFeedPage";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getTournamentSheet = vi.fn();
const getTournamentSheetMappingCatalog = vi.fn();
const upsertTournamentSheetWithValidation = vi.fn();

vi.mock("@/services/balancer-admin.service", () => ({
  default: {
    getTournamentSheet: (...args: unknown[]) => getTournamentSheet(...args),
    getTournamentSheetMappingCatalog: (...args: unknown[]) =>
      getTournamentSheetMappingCatalog(...args),
    upsertTournamentSheetWithValidation: (...args: unknown[]) =>
      upsertTournamentSheetWithValidation(...args),
    syncTournamentSheet: vi.fn(),
    suggestTournamentSheetMapping: vi.fn(),
    previewTournamentSheetMappingRows: vi.fn()
  }
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() })
}));

vi.mock("@/lib/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn(), apiError: vi.fn() }
}));

const CATALOG: MappingCatalog = {
  targets: [
    {
      key: "battle_tag",
      label: "Battle tag",
      group: "identity",
      accepted_parsers: ["text"],
      default_parser: "text",
      default_mode: "columns",
      default_is_list: false,
      multi_column: false,
      required: true
    }
  ],
  parsers: [{ parser: "text", label: "Text", cardinality: "single", produces: "string" }],
  value_categories: [],
  custom_fields: [],
  header_keys: ["BattleTag"]
};

const FEED: AdminGoogleSheetFeed = {
  id: 3,
  tournament_id: 95,
  source_url: "https://docs.google.com/spreadsheets/d/abc",
  sheet_id: "abc",
  gid: null,
  title: "Season 9",
  header_row_json: ["BattleTag"],
  mapping_config_json: null,
  value_mapping_json: null,
  auto_sync_enabled: false,
  auto_sync_interval_seconds: 300,
  last_synced_at: null,
  last_sync_status: null,
  last_error: null
};

let container: HTMLDivElement;
let root: Root;

async function settle(times = 4) {
  for (let turn = 0; turn < times; turn += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
}

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
      >
        <SheetsFeedPage tournamentId={95} />
      </QueryClientProvider>
    );
  });
  await settle();
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      globalThis.HTMLInputElement.prototype,
      "value"
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle(2);
}

function saveBar() {
  return container.querySelector('[aria-label="Unsaved changes"]');
}

function button(label: string) {
  return [...container.querySelectorAll("button")].find(
    (node) => node.textContent?.trim() === label
  );
}

function urlInput() {
  return container.querySelector<HTMLInputElement>("#sheet-url")!;
}

beforeEach(() => {
  getTournamentSheet.mockReset();
  getTournamentSheetMappingCatalog.mockReset().mockResolvedValue(CATALOG);
  upsertTournamentSheetWithValidation.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("Sheets feed › save bar", () => {
  it("has no save affordance until the first edit, then offers Create feed", async () => {
    getTournamentSheet.mockResolvedValue(null);
    await render();

    expect(saveBar()).toBeNull();
    expect(button("Create feed")).toBeUndefined();

    await type(urlInput(), "https://docs.google.com/spreadsheets/d/new");

    expect(saveBar()).not.toBeNull();
    expect(button("Create feed")).toBeDefined();
    expect(button("Save changes")).toBeUndefined();
  });

  it("labels the bar Save changes for an existing feed and Discard restores the source", async () => {
    getTournamentSheet.mockResolvedValue(FEED);
    await render();

    expect(saveBar()).toBeNull();
    const title = container.querySelector<HTMLInputElement>("#sheet-title")!;
    expect(title.value).toBe("Season 9");

    await type(title, "Renamed");
    expect(button("Save changes")).toBeDefined();

    await act(async () => {
      button("Discard")!.click();
    });
    await settle(2);

    expect(saveBar()).toBeNull();
    expect(container.querySelector<HTMLInputElement>("#sheet-title")!.value).toBe("Season 9");
  });

  it("saves through the bar with the edited source", async () => {
    getTournamentSheet.mockResolvedValue(FEED);
    upsertTournamentSheetWithValidation.mockResolvedValue({ ok: true, feed: FEED });
    await render();

    await type(urlInput(), "https://docs.google.com/spreadsheets/d/moved");
    await act(async () => {
      button("Save changes")!.click();
    });
    await settle(2);

    expect(upsertTournamentSheetWithValidation).toHaveBeenCalledWith(
      95,
      expect.objectContaining({ source_url: "https://docs.google.com/spreadsheets/d/moved" })
    );
  });
});
