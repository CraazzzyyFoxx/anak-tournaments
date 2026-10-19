// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";

import { ConditionTreeCard } from "./ConditionTreeCard";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { getConditionTypes } = vi.hoisted(() => ({ getConditionTypes: vi.fn() }));

// Dynamic imports: `vi.mock` factories are hoisted above the file's static imports.
vi.mock("@/services/discipline.service", async () => (await import("@/test/discipline-metadata")).disciplineServiceMock);
vi.mock("@/services/admin.service", () => ({ default: { getConditionTypes } }));
vi.mock("@/stores/workspace.store", () => ({
  useWorkspaceStore: (select: (state: { currentWorkspaceId: number }) => unknown) => select({ currentWorkspaceId: 7 })
}));
// The card's lazy entry points resolve to the real editor; only the canvas, which needs layout, is drawn inert.
vi.mock("next/dynamic", async () => {
  const editor = await import("@/components/admin/achievements/ConditionFlowEditor");
  return { default: () => editor.ConditionFlowEditor };
});
vi.mock("@/components/rule-builder", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/rule-builder")>()),
  RuleBuilder: ({ readOnly }: { readOnly?: boolean }) => (
    <div data-testid="builder" data-readonly={String(Boolean(readOnly))} />
  )
}));

const STORED = { AND: [{ type: "match_win", params: {} }] };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  getConditionTypes.mockReset();
  getConditionTypes.mockResolvedValue([
    {
      name: "match_win",
      grain: "user",
      description: "",
      required_params: [],
      optional_params: [],
      depends_on: [],
      subcondition_only: false,
      subcondition_ok: false
    }
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function Card({ discipline, tree }: Readonly<{ discipline: string; tree: Record<string, unknown> }>) {
  const [editing, setEditing] = useState(false);
  return (
    <ConditionTreeCard
      conditionTree={tree}
      discipline={discipline}
      canUpdate
      editing={editing}
      onEditingChange={setEditing}
      onSave={() => undefined}
      isSaving={false}
    />
  );
}

async function settle() {
  for (let tick = 0; tick < 4; tick += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
}

async function render(discipline: string, tree: Record<string, unknown> = STORED) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={en}>
          <Card discipline={discipline} tree={tree} />
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  });
  await settle();
}

const editButton = () =>
  [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === en.adminAchievements.detail.editTree
  );

describe("the condition tree card", () => {
  it("shows a game without conditions its stored tree, says so, and never asks for a registry", async () => {
    await render("lol");

    expect(container.textContent).toContain(en.common.discipline.widgetUnsupported);
    expect(editButton()).toBeUndefined();
    expect(container.querySelector('[data-testid="builder"]')?.getAttribute("data-readonly")).toBe("true");
    expect(getConditionTypes).not.toHaveBeenCalled();
  });

  it("draws nothing for an empty tree of a game without conditions, and still asks for no registry", async () => {
    await render("lol", {});

    expect(container.textContent).toContain(en.common.discipline.widgetUnsupported);
    expect(container.querySelector('[data-testid="builder"]')).toBeNull();
    expect(getConditionTypes).not.toHaveBeenCalled();
  });

  it("still opens the editor, on its game's registry, for a game that declares conditions", async () => {
    await render("overwatch");

    expect(container.textContent).not.toContain(en.common.discipline.widgetUnsupported);
    // Reading the stored tree needs no registry; editing it does.
    expect(getConditionTypes).not.toHaveBeenCalled();
    await act(async () => editButton()!.click());
    await settle();

    expect(getConditionTypes).toHaveBeenCalledWith(7, "overwatch");
    expect(container.querySelector('[data-testid="builder"]')?.getAttribute("data-readonly")).toBe("false");
  });
});
