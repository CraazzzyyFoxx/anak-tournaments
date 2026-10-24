// @vitest-environment happy-dom
//
// On a phone the table's controls live in one "⋯" menu whose views and columns
// are a second level of that menu. Pinned here: "Save current view…" closes the
// menu yet its dialog survives and the view lands in the list, and toggling a
// column keeps the menu open on the columns level.
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminTableToolbar, type PickerColumn } from "@/components/data-table/AdminTableToolbar";
import en from "@/i18n/messages/en.json";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;

function tick() {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

/** Radix opens on `pointerdown`, so a bare click never reaches the menu. */
function open(node: Element) {
  return act(async () => {
    node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
  });
}

function click(node: Element) {
  return act(async () => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
  });
}

function item(role: "menuitem" | "menuitemcheckbox", label: string): Element {
  const node = [...document.querySelectorAll(`[role='${role}']`)].find((candidate) =>
    (candidate.textContent ?? "").trim().startsWith(label)
  );
  if (!node) throw new Error(`no ${role} "${label}"`);
  return node;
}

function menuTrigger(): Element {
  const node = container.querySelector("[aria-label='More table actions']");
  if (!node) throw new Error("no menu trigger");
  return node;
}

const pickerColumns: PickerColumn[] = [
  { id: "name", label: "Name", category: "core", defaultVisible: true, mandatory: true },
  { id: "stage", label: "Stage", category: "meta", defaultVisible: true, mandatory: false }
];
const onToggleColumn = vi.fn();

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={en}>
        <AdminTableToolbar
          compact
          showSearch
          searchInputId="search"
          searchLabel="Search"
          searchValue=""
          onSearchChange={() => {}}
          isRefreshing={false}
          offPageSelected={0}
          selectedCount={0}
          onExportCsv={() => {}}
          canExport
          density="comfortable"
          onToggleDensity={() => {}}
          prefsKey="t"
          visibility={{ stage: true }}
          onVisibilityChange={() => {}}
          pickerColumns={pickerColumns}
          onToggleColumn={onToggleColumn}
          onResetColumns={() => {}}
        />
      </NextIntlClientProvider>
    );
  });
}

// Node 22's own `localStorage` is unusable without `--localstorage-file`, and
// happy-dom does not shadow it: a per-test in-memory store stands in.
beforeEach(() => {
  const stored = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return stored.size;
      },
      key: (index: number) => Array.from(stored.keys())[index] ?? null,
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, String(value)),
      removeItem: (key: string) => void stored.delete(key),
      clear: () => stored.clear()
    }
  });
  onToggleColumn.mockClear();
  window.history.replaceState(null, "", "/admin/x?status=pending");
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  document.body.innerHTML = "";
});

describe("AdminTableToolbar on a phone", () => {
  it("saves a view from the menu even though the menu closes for the dialog", async () => {
    await render();
    await open(menuTrigger());
    await click(item("menuitem", "Views"));
    await click(item("menuitem", "Save current view"));

    expect(document.querySelector("[role='menu']")).toBeNull();
    const input = document.getElementById("admin-saved-view-name") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setValue.call(input, "Pending");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await tick();
    });

    await open(menuTrigger());
    await click(item("menuitem", "Views"));
    expect(item("menuitem", "Pending")).toBeTruthy();
  });

  it("toggles a column without leaving the columns level", async () => {
    await render();
    await open(menuTrigger());
    await click(item("menuitem", "Columns"));
    await click(item("menuitemcheckbox", "Stage"));

    expect(onToggleColumn).toHaveBeenCalledWith("stage");
    expect(item("menuitemcheckbox", "Stage")).toBeTruthy();
    expect(item("menuitemcheckbox", "Name").getAttribute("aria-disabled")).toBe("true");
  });
});
