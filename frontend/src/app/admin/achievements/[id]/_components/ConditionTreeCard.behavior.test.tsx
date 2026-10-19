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

// Dynamic import: `vi.mock` factories are hoisted above the file's static imports.
vi.mock("@/services/discipline.service", async () => (await import("@/test/discipline-metadata")).disciplineServiceMock);
// The flow canvas is a lazy @xyflow chunk; the gate is about which of its two modes the card mounts.
vi.mock("next/dynamic", () => ({
  default: () =>
    function Flow({ readOnly }: Readonly<{ readOnly?: boolean }>) {
      return <div data-flow={readOnly ? "viewer" : "editor"} />;
    }
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function Card({ discipline }: Readonly<{ discipline: string }>) {
  const [editing, setEditing] = useState(false);
  return (
    <ConditionTreeCard
      conditionTree={{ type: "stat", params: {} }}
      discipline={discipline}
      canUpdate
      editing={editing}
      onEditingChange={setEditing}
      onSave={() => undefined}
      isSaving={false}
    />
  );
}

async function render(discipline: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={en}>
          <Card discipline={discipline} />
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  });
  for (let tick = 0; tick < 3; tick += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
}

const editButton = () =>
  [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === en.adminAchievements.detail.editTree
  );

describe("the condition tree card", () => {
  it("says a game without achievement conditions does not support them, and offers no editor", async () => {
    await render("lol");

    expect(container.textContent).toContain(en.common.discipline.widgetUnsupported);
    expect(editButton()).toBeUndefined();
    // The stored tree stays readable.
    expect(container.querySelector('[data-flow="viewer"]')).not.toBeNull();
    expect(container.querySelector('[data-flow="editor"]')).toBeNull();
  });

  it("still opens the editor for a game that declares conditions", async () => {
    await render("overwatch");

    expect(container.textContent).not.toContain(en.common.discipline.widgetUnsupported);
    const edit = editButton();
    expect(edit).toBeDefined();
    await act(async () => edit!.click());

    expect(container.querySelector('[data-flow="editor"]')).not.toBeNull();
  });
});
