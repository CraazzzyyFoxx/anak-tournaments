import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PageHero } from "./PageHero";

/** The grid and the teal glow — the frame's identity, present in both cases. */
function decorativeLayers(markup: string) {
  return {
    grid: markup.includes("48px 48px"),
    glow: markup.includes("var(--aqt-hero-glow)")
  };
}

describe("PageHero cover banner", () => {
  it("renders a lazily-loaded banner with a scrim under the existing layers", () => {
    const markup = renderToStaticMarkup(
      <PageHero title="Overwatch Cup" coverUrl="https://cdn.example.test/cover.png" />
    );

    expect(markup).toContain('src="https://cdn.example.test/cover.png"');
    expect(markup).toContain('loading="lazy"');
    // Decorative only: the hero title already names the page.
    expect(markup).toContain('alt=""');
    // Without the scrim a bright banner drops the title under 4.5:1.
    expect(markup).toContain("var(--aqt-bg) 92%");

    // The banner must sit BELOW the grid, not over it.
    expect(markup.indexOf("cover.png")).toBeLessThan(markup.indexOf("48px 48px"));
    expect(decorativeLayers(markup)).toEqual({ grid: true, glow: true });
  });

  it("emits no image layer without a cover, leaving the frame untouched", () => {
    const markup = renderToStaticMarkup(<PageHero title="Overwatch Cup" />);

    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("var(--aqt-bg) 92%");
    expect(decorativeLayers(markup)).toEqual({ grid: true, glow: true });
  });
});
