import { afterAll, describe, expect, it, mock } from "bun:test";
import { Window } from "happy-dom";
import { act, useState, type ReactNode } from "react";

import type { Hero } from "@/types/hero.types";
import type { RegistrationForm } from "@/types/registration.types";

import { createRoleSelections, isFlexSelection, type RoleSelections } from "./types";

const testWindow = new Window({ url: "http://localhost:3000/", width: 720, height: 900 });
const previousGlobals = new Map<PropertyKey, PropertyDescriptor | undefined>();

mock.module("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));
mock.module("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element -- test stand-in, never shipped
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}));
// Radix portals and pointer measurement do not work under happy-dom, and the
// closed state is what this test measures: only the trigger is on the surface.
mock.module("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: () => null,
}));
mock.module("@/components/ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children, ...rest }: { children: ReactNode }) => (
    <button type="button" {...rest}>
      {children}
    </button>
  ),
  SelectValue: () => null,
  SelectContent: () => null,
  SelectItem: () => null,
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
  previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, value, writable: true });
}

// `mock.module` must be registered before the module graph under test loads.
const { createRoot } = await import("react-dom/client");
const RoleStep = (await import("./RoleStep")).default;

const HEROES: Hero[] = [
  ["reinhardt", "tank"],
  ["dva", "tank"],
  ["genji", "damage"],
  ["ashe", "damage"],
  ["ana", "support"],
  ["kiriko", "support"],
].map(([slug, role], index) => ({
  id: index + 1,
  slug,
  name: slug,
  role,
  type: role,
  image_path: `/heroes/${slug}.png`,
}) as unknown as Hero);

const FORM = {
  built_in_fields: {},
  custom_fields: [],
  subrole_catalog: {
    tank: [{ slug: "main-tank", label: "Main tank" }],
    dps: [{ slug: "hitscan", label: "Hitscan" }],
    support: [{ slug: "main-heal", label: "Main heal" }],
  },
} as unknown as RegistrationForm;

let container = testWindow.document.createElement("div");
let root = createRoot(container as unknown as Element);
let latest: RoleSelections = createRoleSelections();

type FlexMode = "off" | "optional" | "forced";

function Harness({ flexMode = "optional" as FlexMode }: { flexMode?: FlexMode }) {
  const [selections, setSelections] = useState<RoleSelections>(
    createRoleSelections(flexMode === "forced"),
  );
  return (
    <RoleStep
      selections={selections}
      onChange={(next) => {
        latest = next;
        setSelections(next);
      }}
      form={FORM}
      allHeroes={HEROES}
      topHeroesEnabled
      maxHeroes={5}
      flexMode={flexMode}
    />
  );
}

/** Each case needs its own root: re-rendering into one keeps the previous state. */
function mount(flexMode: FlexMode = "optional") {
  container = testWindow.document.createElement("div");
  testWindow.document.body.appendChild(container);
  root = createRoot(container as unknown as Element);
  latest = createRoleSelections(flexMode === "forced");
  act(() => root.render(<Harness flexMode={flexMode} />));
}

function surface() {
  return {
    controls: container.querySelectorAll('button, [tabindex="0"]').length,
    elements: container.querySelectorAll("*").length,
    radios: container.querySelectorAll('[role="radio"]').length,
    stateful: container.querySelectorAll("[aria-checked],[aria-pressed]").length,
  };
}

function click(selector: string, index = 0) {
  const el = container.querySelectorAll(selector)[index] as unknown as HTMLElement | undefined;
  if (!el) throw new Error(`no element for ${selector}[${index}]`);
  act(() => {
    el.dispatchEvent(new testWindow.MouseEvent("click", { bubbles: true }) as unknown as Event);
  });
}

/** `[role="radio"]` order is tank(off,fallback,main), dps(...), support(...). */
const MAIN = { tank: 2, dps: 5, support: 8 } as const;

describe("RoleStep", () => {
  it("keeps the rendered control set identical no matter what is selected", () => {
    mount();
    const initial = surface();
    // 3 rows x (3 priority radios + specialization + hero picker) + flex preset.
    // The roster lives behind the hero popover, so it never lands on this surface.
    expect(initial.controls).toBe(16);

    click('[role="radio"]', MAIN.dps);
    expect(surface()).toEqual(initial);

    click('[role="radio"]', MAIN.tank - 1); // tank → fallback
    expect(surface()).toEqual(initial);

    click('[aria-pressed]', 0); // flex preset
    expect(surface()).toEqual(initial);

    // Every control exposes its own state instead of relying on border colour:
    // three radiogroups of three, plus the flex preset toggle.
    expect(initial.radios).toBe(9);
    expect(initial.stateful).toBe(10);
  });

  it("allows exactly one main role, or every role for flex", () => {
    mount();

    click('[role="radio"]', MAIN.dps);
    expect(latest.dps.priority).toBe("main");

    click('[role="radio"]', MAIN.tank);
    expect(latest.tank.priority).toBe("main");
    expect(latest.dps.priority).toBe("fallback");
    expect(isFlexSelection(latest)).toBe(false);
  });

  it("marks every role main through the flex preset and keeps one main on exit", () => {
    mount();

    click('[aria-pressed]', 0);
    expect(isFlexSelection(latest)).toBe(true);

    click('[aria-pressed]', 0);
    expect(isFlexSelection(latest)).toBe(false);
    expect(Object.values(latest).filter((entry) => entry.priority === "main")).toHaveLength(1);
  });
});

describe("RoleStep forced-flex mode", () => {
  it("renders no priority control and no flex preset", () => {
    mount("forced");

    // The priority radiogroups and the preset toggle are what disappear; the
    // specialization select and the hero picker stay, one per role.
    expect(surface().radios).toBe(0);
    expect(container.querySelectorAll("[aria-pressed]").length).toBe(0);
    expect(surface().controls).toBe(6);
  });

  it("starts with every role main, so the submission is flex", () => {
    mount("forced");

    expect(isFlexSelection(latest)).toBe(true);
    expect(Object.values(latest).every((entry) => entry.priority === "main")).toBe(true);
  });

  it("has no control that can take a role out of the selection", () => {
    // `off` is what would break a forced submission: buildRolesPayload only
    // sends roles whose priority is not `off`. The priority radiogroup is the
    // only control that can set it, and it is not rendered here — the
    // specialization and hero controls only ever promote. Asserted structurally
    // because the Radix Select opens a portal that happy-dom cannot drive.
    mount("forced");

    expect(container.querySelectorAll('[role="radiogroup"]').length).toBe(0);
    expect(container.querySelectorAll('[role="radio"]').length).toBe(0);
    expect(Object.values(latest).some((entry) => entry.priority === "off")).toBe(false);
  });

  it("still offers the preset in optional mode", () => {
    mount("optional");

    expect(container.querySelectorAll("[aria-pressed]").length).toBe(1);
  });

  it("offers neither the preset nor an all-main state when flex is banned", () => {
    mount("off");

    expect(container.querySelectorAll("[aria-pressed]").length).toBe(0);
    expect(surface().radios).toBe(9);
  });
});

afterAll(() => {
  act(() => root.unmount());
  for (const [key, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
