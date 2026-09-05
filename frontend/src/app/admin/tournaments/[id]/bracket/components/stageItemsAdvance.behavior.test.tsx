// @vitest-environment happy-dom
//
// One claim: how many teams advance can be set per GROUP, not only per stage.
//
// `Stage.advance_count` is one number for every group in the stage. A tournament
// that takes 3 from a strong group and 2 from the rest had no way to say so, and
// the projection silently multiplied the stage number by the group count. The
// per-group override needs a way in, and clearing the field has to mean "inherit
// the stage again" — an explicit `null`, not an omitted key, which the API reads
// as "leave it alone".
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Stage, StageItem } from "@/types/tournament.types";

import { StageItemsSection } from "./StageItemsSection";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const updateStageItem = vi.fn();

vi.mock("@/services/admin.service", () => ({
  default: {
    updateStageItem: (...args: unknown[]) => updateStageItem(...args),
    createStageItem: vi.fn(),
    createStageItemInput: vi.fn(),
    updateStageItemInput: vi.fn()
  }
}));

vi.mock("@/lib/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn(), apiError: vi.fn() }
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: unknown }) => (
    <a href={href}>{children as never}</a>
  )
}));

function item(id: number, overrides: Partial<StageItem> = {}): StageItem {
  return {
    id,
    stage_id: 10,
    name: `Group ${id}`,
    type: "group",
    order: 0,
    advance_count: null,
    inputs: [],
    ...overrides
  };
}

function groupStage(items: StageItem[]): Stage {
  return {
    id: 10,
    tournament_id: 84,
    name: "Groups",
    description: null,
    stage_type: "round_robin",
    max_rounds: 3,
    advance_count: 2,
    split_lower_bracket: false,
    order: 0,
    is_active: true,
    is_published: true,
    is_completed: false,
    settings_json: null,
    challonge_id: null,
    challonge_slug: null,
    items
  };
}

let container: HTMLDivElement;
let root: Root;

async function settle() {
  for (let index = 0; index < 4; index += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
}

async function mount(stage: Stage) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <StageItemsSection
          stage={stage}
          stages={[stage]}
          teams={[]}
          isTeamsLoading={false}
          progress={undefined}
          encountersHref="/admin/tournaments/84/matches/encounters?stage=10"
          onChanged={() => {}}
          onRequestDeleteItem={() => {}}
        />
      </QueryClientProvider>
    );
  });
  await settle();
}

function advanceInput(stageItemId: number) {
  const input = container.querySelector<HTMLInputElement>(`#stage-item-advance-${stageItemId}`);
  if (!input) throw new Error(`No advance field for item ${stageItemId}`);
  return input;
}

async function typeAndBlur(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // React delegates `onBlur` off the bubbling `focusout` event, not `blur`.
  await act(async () => {
    input.dispatchEvent(new Event("focusout", { bubbles: true }));
  });
  await settle();
}

beforeEach(() => {
  updateStageItem.mockReset();
  updateStageItem.mockResolvedValue({});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

describe("per-group advance count", () => {
  it("offers the stage's number as the placeholder every group inherits", async () => {
    await mount(groupStage([item(100), item(101, { advance_count: 3, order: 1 })]));

    expect(advanceInput(100).placeholder).toBe("Inherit (2)");
    expect(advanceInput(100).value).toBe("");
    // A group that overrides shows its own number, not the stage's.
    expect(advanceInput(101).value).toBe("3");
  });

  it("saves the typed override for that group alone", async () => {
    await mount(groupStage([item(100), item(101, { order: 1 })]));

    await typeAndBlur(advanceInput(100), "3");

    expect(updateStageItem).toHaveBeenCalledTimes(1);
    expect(updateStageItem).toHaveBeenCalledWith(100, { advance_count: 3 });
  });

  it("clears the override back to the stage with an explicit null", async () => {
    await mount(groupStage([item(100, { advance_count: 3 })]));

    await typeAndBlur(advanceInput(100), "");

    expect(updateStageItem).toHaveBeenCalledWith(100, { advance_count: null });
  });

  it("leaves a bracket lane alone: it has nothing to advance", async () => {
    await mount(groupStage([item(100, { type: "bracket_upper" })]));

    expect(container.querySelector("#stage-item-advance-100")).toBeNull();
  });
});
