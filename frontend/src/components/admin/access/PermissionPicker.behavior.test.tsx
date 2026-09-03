// @vitest-environment happy-dom
//
// `PermissionPicker` — the one control that replaced the role matrix, the
// API-key `ScopePicker` and `UserDenyEditor`. What is pinned here:
//  1. it holds no draft: a toggle reports the whole next `Set` to the caller;
//  2. a held wildcard locks the rows it covers, in both modes — the box would
//     be a no-op, and rendering it unchecked would claim the opposite of the
//     truth;
//  3. `readOnly` disables every control rather than hiding the grants;
//  4. the narrowing box and bulk buttons appear only for a catalogue big
//     enough to need them.
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PermissionPicker,
  wildcardCovers,
  type PermissionCatalogEntry
} from "@/components/admin/access/PermissionPicker";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CATALOG: PermissionCatalogEntry[] = [
  { key: "match.read", resource: "match", action: "read" },
  { key: "match.update", resource: "match", action: "update" },
  { key: "team.read", resource: "team", action: "read", description: "See the roster" }
];

const mounted: { root: Root; container: HTMLElement }[] = [];

async function mount(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => {
    root.render(node);
  });
  return container;
}

async function click(element: Element | null | undefined) {
  expect(element).toBeTruthy();
  await act(async () => {
    (element as HTMLElement).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    element!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function box(key: string) {
  return document.querySelector(`[aria-label="Toggle ${key}"]`);
}

afterEach(async () => {
  await act(async () => {
    for (const { root, container } of mounted.splice(0)) {
      root.unmount();
      container.remove();
    }
  });
  document.body.innerHTML = "";
});

describe("PermissionPicker", () => {
  it("reports the whole next selection when a matrix cell is checked", async () => {
    const onChange = vi.fn();
    await mount(
      <PermissionPicker catalog={CATALOG} value={new Set(["match.read"])} onChange={onChange} />
    );

    await click(box("match.update"));

    expect([...onChange.mock.calls[0][0]].sort()).toEqual(["match.read", "match.update"]);
  });

  it("drops a key when its cell is unchecked", async () => {
    const onChange = vi.fn();
    await mount(
      <PermissionPicker catalog={CATALOG} value={new Set(["match.read"])} onChange={onChange} />
    );

    await click(box("match.read"));

    expect([...onChange.mock.calls[0][0]]).toEqual([]);
  });

  it("toggles a whole resource row at once", async () => {
    const onChange = vi.fn();
    await mount(<PermissionPicker catalog={CATALOG} value={new Set()} onChange={onChange} />);

    await click(document.querySelector('[aria-label="Toggle every match permission"]'));

    expect([...onChange.mock.calls[0][0]].sort()).toEqual(["match.read", "match.update"]);
  });

  it("locks every row a held global wildcard covers", async () => {
    await mount(
      <PermissionPicker
        catalog={CATALOG}
        wildcards={["admin.*"]}
        value={new Set(["admin.*"])}
        onChange={vi.fn()}
      />
    );

    for (const entry of CATALOG) {
      expect(box(entry.key)?.getAttribute("data-state")).toBe("checked");
      expect(box(entry.key)?.hasAttribute("disabled")).toBe(true);
    }
  });

  it("locks only its own resource for a resource wildcard", async () => {
    await mount(
      <PermissionPicker
        mode="list"
        catalog={CATALOG}
        wildcards={["match.*"]}
        value={new Set(["match.*"])}
        onChange={vi.fn()}
      />
    );

    expect(box("match.read")?.hasAttribute("disabled")).toBe(true);
    expect(box("team.read")?.hasAttribute("disabled")).toBe(false);
  });

  it("renders list mode grouped by resource with descriptions", async () => {
    const container = await mount(
      <PermissionPicker mode="list" catalog={CATALOG} value={new Set()} onChange={vi.fn()} />
    );

    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent).toContain("See the roster");
    expect(container.textContent).toContain("team");
  });

  it("disables every control when read-only", async () => {
    const container = await mount(
      <PermissionPicker
        catalog={CATALOG}
        value={new Set(["match.read"])}
        onChange={vi.fn()}
        readOnly
      />
    );

    expect(box("match.read")?.hasAttribute("disabled")).toBe(true);
    expect(container.textContent).toContain("1/3 selected");
  });

  it("offers narrowing and bulk selection only for a catalogue that needs it", async () => {
    const small = await mount(
      <PermissionPicker catalog={CATALOG} value={new Set()} onChange={vi.fn()} />
    );
    expect(small.querySelector('input[type="search"]')).toBeNull();

    const wide: PermissionCatalogEntry[] = Array.from({ length: 12 }, (_, index) => ({
      key: `res${index}.read`,
      resource: `res${index}`,
      action: "read"
    }));
    const large = await mount(
      <PermissionPicker catalog={wide} value={new Set()} onChange={vi.fn()} />
    );
    expect(large.querySelector('input[type="search"]')).not.toBeNull();
  });
});

describe("wildcardCovers", () => {
  it("treats admin.* as the catalogue-wide grant", () => {
    expect(wildcardCovers("admin.*", CATALOG[0])).toBe(true);
    expect(wildcardCovers("admin.*", CATALOG[2])).toBe(true);
  });

  it("scopes resource.* to that resource", () => {
    expect(wildcardCovers("match.*", CATALOG[0])).toBe(true);
    expect(wildcardCovers("match.*", CATALOG[2])).toBe(false);
  });

  it("ignores a malformed wildcard rather than granting everything", () => {
    expect(wildcardCovers("match", CATALOG[0])).toBe(false);
    expect(wildcardCovers("match.read", CATALOG[0])).toBe(false);
  });
});
