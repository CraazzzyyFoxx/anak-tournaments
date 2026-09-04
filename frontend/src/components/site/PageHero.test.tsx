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
  it("renders the banner as a blurred wash, not as a picture", () => {
    const markup = renderToStaticMarkup(
      <PageHero title="Overwatch Cup" coverUrl="https://cdn.example.test/cover.png" />
    );

    expect(markup).toContain('src="https://cdn.example.test/cover.png"');
    expect(markup).toContain('loading="lazy"');
    // Decorative only: the hero title already names the page.
    expect(markup).toContain('alt=""');
    // Blurred, oversaturated and blended, all inline: `mix-blend-mode: color`
    // takes hue from the image and luminance from the frame, so no upload can
    // move a contrast ratio, and saturation is the one channel such a blend can
    // spend. A scrim could not do this — `--aqt-fg-faint` sits at 5.1:1 on
    // `--aqt-bg`, and a white cover bleeding 5% of its light drops it to ~2.6:1.
    expect(markup).toContain("mix-blend-mode:color");
    expect(markup).toContain("blur(28px) saturate(2.2)");
    expect(markup).toContain("scale(1.12)");
    // The blend has to stay inside the hero, not reach the page behind it.
    expect(markup).toContain("isolate");
    // No band is reserved and no scrim is painted: the wash is behind the copy.
    expect(markup).not.toContain("padding-top");

    // The wash sits BELOW the grid and glow, which are the frame's identity.
    expect(markup.indexOf("cover.png")).toBeLessThan(markup.indexOf("48px 48px"));
    expect(decorativeLayers(markup)).toEqual({ grid: true, glow: true });
  });

  it("emits no image layer without a cover, leaving the frame untouched", () => {
    const markup = renderToStaticMarkup(<PageHero title="Overwatch Cup" />);

    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("mix-blend-mode");
    expect(decorativeLayers(markup)).toEqual({ grid: true, glow: true });
  });
});
