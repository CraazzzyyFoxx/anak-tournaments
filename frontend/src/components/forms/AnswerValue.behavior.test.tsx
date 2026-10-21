// A `role_ranks` answer is the registrant's SR on their game's native ladder, typed in
// `RoleRanksField`. Reading it back through the workspace grid renamed every number under
// them — the admin registrations table showed a workspace's own division beside an SR that
// is Diamond 3 on the native ladder. The owner's metadata names the native scale; nothing is borrowed.
import { describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { act } from "react";

const testWindow = new Window({ url: "http://localhost:3000/", width: 720, height: 900 });

// The role glyph localizes its own label; no provider in a unit render.
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => Object.assign((key: string) => key, { has: () => false })
}));
vi.mock("@/lib/datetime/client", () => ({
  useFormatter: () => ({ dateTime: (value: Date) => value.toISOString() })
}));

// `next/image` rewrites src through the optimizer loader; the stand-in keeps
// the stored URL so the test can read it.
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element -- this IS the next/image stand-in
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} alt={props.alt ?? ""} />
}));

// A workspace grid that calls every rank one thing. If the chip reads it, the
// crest below says "Workspace Apex" instead of the OW ladder's division.
vi.mock("@/hooks/useCurrentWorkspace", () => ({
  useDivisionGrid: () => ({
    tiers: [
      {
        number: 1,
        name: "Workspace Apex",
        slug: "workspace-apex",
        sort_order: 0,
        rank_min: 0,
        rank_max: null,
        icon_url: "https://example.invalid/workspace-apex.png",
      },
    ],
  }),
}));

for (const [key, value] of Object.entries({
  window: testWindow,
  document: testWindow.document,
  navigator: testWindow.navigator,
  HTMLElement: testWindow.HTMLElement,
  Event: testWindow.Event,
  Node: testWindow.Node,
  MutationObserver: testWindow.MutationObserver,
  getComputedStyle: testWindow.getComputedStyle.bind(testWindow),
  requestAnimationFrame: testWindow.requestAnimationFrame.bind(testWindow),
  cancelAnimationFrame: testWindow.cancelAnimationFrame.bind(testWindow),
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  Object.defineProperty(globalThis, key, { configurable: true, value, writable: true });
}

// `mock.module` must be registered before the module graph under test loads.
const { createRoot } = await import("react-dom/client");
const { AnswerValue } = await import("./AnswerValue");
const { OW_METADATA } = await import("@/test/discipline-metadata");

const NATIVE_LADDER = [
  {
    number: 12,
    name: "Diamond 3",
    slug: "diamond-3",
    native_division: "diamond",
    native_tier: 3,
    rank_min: 3100,
    rank_max: 3299,
    icon_url: "/divisions/diamond-3.png"
  }
];

function render(ontology: typeof OW_METADATA) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<AnswerValue value={{ damage: 3200 }} kind="role_ranks" ontology={ontology} />));
  return { container, unmount: () => act(() => root.unmount()) };
}

describe("AnswerValue role_ranks chips", () => {
  it("crests an SR off the owner's native ladder, not the workspace grid", () => {
    const { container, unmount } = render({ ...OW_METADATA, native_ladder: NATIVE_LADDER });

    // The role glyph keeps a hidden `alt=""` probe image of its own; the crest is the one that names a division.
    const crest = container.querySelector('img:not([alt=""])');
    expect(crest?.getAttribute("alt")).toBe("Diamond 3");
    expect(crest?.getAttribute("src")).toBe("/divisions/diamond-3.png");
    expect(container.textContent).toContain("3200");
    // The role code resolves through the dictionary: a glyph, not the "unknown role" `?`.
    expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).not.toContain("unknown");

    unmount();
  });

  it("draws no crest for a game without a native ladder", () => {
    const { container, unmount } = render({ ...OW_METADATA, native_ladder: [] });

    expect(container.querySelector('img:not([alt=""])')).toBeNull();
    expect(container.textContent).toContain("3200");

    unmount();
  });
});
