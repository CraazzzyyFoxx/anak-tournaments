// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import CatalogEntityImage from "@/components/catalog/CatalogEntityImage";
import { catalogEntity } from "@/test/catalog";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

const render = (node: React.ReactNode) => act(() => root.render(node));

describe("CatalogEntityImage", () => {
  it("paints the portrait with the entity's name as its accessible label", () => {
    render(<CatalogEntityImage entity={catalogEntity({ id: 1, name: "Ahri", image_path: "https://cdn/ahri.png", discipline: "lol" })} size={40} />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://cdn/ahri.png");
    expect(img?.getAttribute("alt")).toBe("Ahri");
    expect(img?.getAttribute("loading")).toBe("lazy");
    expect(container.querySelector("span")?.getAttribute("style")).toContain("width: 40px");
  });

  it("falls back to initials when there is no portrait, or when it fails to load", () => {
    render(<CatalogEntityImage entity={catalogEntity({ id: 2, name: "Lee Sin", image_path: null })} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("LS");

    render(<CatalogEntityImage entity={catalogEntity({ id: 3, name: "Zed", image_path: "https://cdn/broken.png" })} />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    act(() => {
      img!.dispatchEvent(new Event("error"));
    });
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("ZE");
  });

  it("hides a decorative portrait from assistive technology instead of repeating the name beside it", () => {
    render(<CatalogEntityImage entity={catalogEntity({ id: 4, name: "Ana", image_path: "https://cdn/ana.png" })} decorative />);
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("");
  });

  it("renders a neutral, hidden placeholder for a missing reference", () => {
    render(<CatalogEntityImage entity={null} />);
    expect(container.querySelector("span")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.textContent).toBe("?");
  });

  it("takes its accent from nothing: a character's class never colors the tile", () => {
    render(<CatalogEntityImage entity={catalogEntity({ id: 5, name: "Mercy", attrs: { class: "support" } })} />);
    expect(container.innerHTML).not.toContain("aqt-support");
  });

  it("stays closed once its card closes: focus is never handed back to the trigger, which would reopen it", async () => {
    render(<CatalogEntityImage entity={catalogEntity({ id: 6, name: "Mei" })} popover={<p>card</p>} />);
    const trigger = container.querySelector("button")!;
    act(() => trigger.focus());
    expect(document.body.textContent).toContain("card");

    act(() => trigger.blur());
    // Radix hands focus back on a timer after the content unmounts.
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 20);
      await promise;
    });

    expect(document.body.textContent).not.toContain("card");
    expect(document.activeElement).not.toBe(trigger);
  });
});
