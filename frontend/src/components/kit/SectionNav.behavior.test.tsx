// @vitest-environment happy-dom
//
// The section rail for T5 settings screens. What is pinned here:
//  1. the active section carries `aria-current="page"`, and exactly one does;
//  2. a hidden (permission-gated) section is absent from BOTH the rail and the
//     narrow-viewport `Select` — one list, two renderings, no drift;
//  3. picking a section in the `Select` navigates, so the mobile control is a
//     real navigation and not a second source of state;
//  4. picking a section moves the page the way scrolling to it would: one
//     below the open section rises from below, one above drops from above,
//     and a new-tab click leaves nothing behind for a later visit to play.
import { act, forwardRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SectionNav, useSectionNavEntrance } from "@/components/kit/SectionNav";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const push = vi.fn();
let pathname = "/admin/tournaments/1/settings/rules";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push })
}));

vi.mock("next/link", () => ({
  default: forwardRef<
    HTMLAnchorElement,
    { href: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>
  >(function Link({ href, children, ...props }, ref) {
    return (
      <a ref={ref} href={href} {...props}>
        {children}
      </a>
    );
  })
}));

const GROUPS = [
  {
    label: "Tournament",
    items: [
      { key: "general", label: "General", href: "/admin/tournaments/1/settings/general" },
      { key: "rules", label: "Rules & scoring", href: "/admin/tournaments/1/settings/rules" },
      {
        key: "links",
        label: "Links",
        href: "/admin/tournaments/1/settings/links",
        hidden: true
      }
    ]
  },
  {
    items: [
      {
        key: "danger",
        label: "Danger zone",
        href: "/admin/tournaments/1/settings/danger",
        tone: "danger" as const
      }
    ]
  }
];

let container: HTMLElement;
let root: Root;

async function render(activeKey = "rules") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<SectionNav groups={GROUPS} activeKey={activeKey} />);
  });
}

async function click(element: Element | null | undefined) {
  await act(async () => {
    element?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  push.mockClear();
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  document.body.innerHTML = "";
});

describe("SectionNav", () => {
  it("marks exactly the active section", async () => {
    await render("rules");

    const current = [...container.querySelectorAll("nav a")].filter(
      (link) => link.getAttribute("aria-current") === "page"
    );
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toBe("Rules & scoring");
  });

  it("omits a hidden section from the rail", async () => {
    await render();

    const labels = [...container.querySelectorAll("nav a")].map((link) => link.textContent);
    expect(labels).toEqual(["General", "Rules & scoring", "Danger zone"]);
  });

  it("navigates when a section is picked on a narrow viewport", async () => {
    await render("general");

    await click(container.querySelector('button[role="combobox"]'));
    const option = [...document.querySelectorAll('[role="option"]')].find(
      (item) => item.textContent?.trim() === "Danger zone"
    );
    await act(async () => {
      option?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      option?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(push).toHaveBeenCalledWith("/admin/tournaments/1/settings/danger");
  });

  it("does not offer a hidden section in the Select either", async () => {
    await render("general");

    await click(container.querySelector('button[role="combobox"]'));
    const options = [...document.querySelectorAll('[role="option"]')].map((item) =>
      item.textContent?.trim()
    );
    expect(options).not.toContain("Links");
  });
});

describe("SectionNav entrance", () => {
  const animate = vi.fn();
  const preventNavigation = (event: Event) => event.preventDefault();

  function Hub() {
    const columnRef = useSectionNavEntrance<HTMLDivElement>();
    const activeKey = GROUPS.flatMap((group) => group.items).find((item) => item.href === pathname)?.key;
    return (
      <>
        <SectionNav groups={GROUPS} activeKey={activeKey ?? ""} />
        <div ref={columnRef} />
      </>
    );
  }

  async function navigate(to: string) {
    pathname = to;
    await act(async () => root.render(<Hub />));
  }

  async function pick(label: string, init: MouseEventInit = {}) {
    const link = [...container.querySelectorAll("nav a")].find((a) => a.textContent === label);
    await act(async () => {
      link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
    });
  }

  /** The first keyframe's offset: positive rises from below, negative drops from above. */
  const enteredFrom = () => (animate.mock.calls.at(-1)?.[0] as Keyframe[])[0].transform;

  beforeEach(async () => {
    animate.mockReset();
    HTMLElement.prototype.animate = animate as unknown as HTMLElement["animate"];
    document.addEventListener("click", preventNavigation);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await navigate("/admin/tournaments/1/settings/rules");
  });

  afterEach(() => {
    document.removeEventListener("click", preventNavigation);
  });

  it("brings a section below the open one in from below", async () => {
    await pick("Danger zone");
    await navigate("/admin/tournaments/1/settings/danger");

    expect(animate).toHaveBeenCalledTimes(1);
    expect(enteredFrom()).toBe("translateY(32px)");
  });

  it("brings a section above the open one in from above", async () => {
    await pick("General");
    await navigate("/admin/tournaments/1/settings/general");

    expect(animate).toHaveBeenCalledTimes(1);
    expect(enteredFrom()).toBe("translateY(-32px)");
  });

  it("does not play a new-tab pick on a later visit by another route", async () => {
    await pick("Danger zone", { ctrlKey: true });
    await navigate("/admin/tournaments/1/settings/danger");

    expect(animate).not.toHaveBeenCalled();
  });
});
