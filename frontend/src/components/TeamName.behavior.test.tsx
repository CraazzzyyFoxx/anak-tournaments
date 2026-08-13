// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";

import TeamName, { TeamLogo } from "./TeamName";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;

function render(ui: React.ReactNode) {
  const root = createRoot(container);
  act(() => root.render(ui));
  return () => act(() => root.unmount());
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

describe("TeamName", () => {
  it("renders the uploaded image beside the name", () => {
    render(<TeamName team={{ name: "Void Syndicate", image_url: "https://s3.test/t/1.webp" }} />);

    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://s3.test/t/1.webp");
    expect(container.textContent).toContain("Void Syndicate");
  });

  // The whole point of the component: no initials, no coloured glyph, no empty
  // reserved box. A team without an image is name-only on every surface.
  it("renders no image at all when the team has none", () => {
    render(<TeamName team={{ name: "Void Syndicate", image_url: null }} />);

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("Void Syndicate");
  });

  it("falls back to the given label with no image when there is no team", () => {
    render(<TeamName team={null} fallback="TBD" />);

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("TBD");
  });

  it("keeps the full name reachable while truncating", () => {
    render(<TeamName team={{ name: "A Very Long Team Name Indeed", image_url: null }} />);

    const name = container.querySelector("[title]");
    expect(name?.getAttribute("title")).toBe("A Very Long Team Name Indeed");
    expect(name?.className).toContain("truncate");
  });

  it("hides the logo from assistive tech when the name sits next to it", () => {
    render(<TeamName team={{ name: "Nova", image_url: "https://s3.test/t/2.png" }} />);

    const img = container.querySelector("img");
    expect(img?.getAttribute("aria-hidden")).toBe("true");
    expect(img?.getAttribute("alt")).toBe("");
  });
});

describe("TeamLogo", () => {
  it("names itself when it stands alone", () => {
    render(<TeamLogo team={{ name: "Nova", image_url: "https://s3.test/t/2.png" }} alt="Nova" />);

    const img = container.querySelector("img");
    expect(img?.getAttribute("alt")).toBe("Nova");
    expect(img?.hasAttribute("aria-hidden")).toBe(false);
  });

  it("scales with the size token", () => {
    render(<TeamLogo team={{ name: "Nova", image_url: "https://s3.test/t/2.png" }} size="xl" />);

    const img = container.querySelector("img");
    expect(img?.getAttribute("width")).toBe("52");
    expect(img?.getAttribute("height")).toBe("52");
  });

  it("renders nothing without an image", () => {
    render(<TeamLogo team={{ name: "Nova" }} />);

    expect(container.querySelector("img")).toBeNull();
  });
});
