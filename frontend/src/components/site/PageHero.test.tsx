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
  it("renders a lazily-loaded banner inside its own band, clear of the copy", () => {
    const markup = renderToStaticMarkup(
      <PageHero title="Overwatch Cup" coverUrl="https://cdn.example.test/cover.png" />
    );

    expect(markup).toContain('src="https://cdn.example.test/cover.png"');
    expect(markup).toContain('loading="lazy"');
    // Decorative only: the hero title already names the page.
    expect(markup).toContain('alt=""');
    // The picture is confined to its band and fades into the frame there; the
    // copy below it sits on plain `bg`, so contrast never depends on the upload.
    expect(markup).toContain("height:80px");
    expect(markup).toContain("transparent 0%");
    expect(markup).toContain("var(--aqt-bg) 100%");
    // ...and the copy is pushed clear of the band by the same 80px.
    expect(markup).toContain("padding-top:80px");

    // The band paints OVER the grid and glow: under them the artwork came out
    // teal-washed and cross-hatched. Both layers still frame the copy area.
    expect(markup.indexOf("cover.png")).toBeGreaterThan(markup.indexOf("48px 48px"));
    expect(decorativeLayers(markup)).toEqual({ grid: true, glow: true });
  });

  it("emits no image layer without a cover, leaving the frame untouched", () => {
    const markup = renderToStaticMarkup(<PageHero title="Overwatch Cup" />);

    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("height:80px");
    expect(markup).not.toContain("padding-top");
    expect(decorativeLayers(markup)).toEqual({ grid: true, glow: true });
  });
});
