import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AchievementArt } from "./AchievementArt";
import { ACHIEVEMENT_ART_SLUGS } from "./achievementArtSlugs";

const ART_DIR = fileURLToPath(new URL("../../../public/achievements", import.meta.url));

function render(achievement: { name: string; slug: string; image_url: string | null }) {
  return renderToStaticMarkup(<AchievementArt achievement={achievement} sizes="64px" />);
}

describe("achievement art", () => {
  it("lists exactly the art that ships, so a new file is never skipped and a missing one never requested", () => {
    const shipped = readdirSync(ART_DIR)
      .filter((file) => file.endsWith(".webp"))
      .map((file) => file.slice(0, -".webp".length))
      .sort();
    expect([...ACHIEVEMENT_ART_SLUGS].sort()).toEqual(shipped);
  });

  it("draws the monogram, and requests no file, for a rule whose art does not ship", () => {
    const markup = render({ name: "Night owl", slug: "night-owl-custom", image_url: null });

    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("night-owl-custom");
    expect(markup).toContain(">N<");
  });

  it("uses the shipped art for a rule that has some", () => {
    const markup = render({ name: "Ana", slug: "ana", image_url: null });

    expect(markup).toContain("<img");
    expect(markup).toContain("ana.webp");
  });

  it("prefers an uploaded image to anything shipped", () => {
    const markup = render({ name: "Ana", slug: "ana", image_url: "/uploads/ana-custom.png" });

    expect(markup).toContain("ana-custom.png");
    expect(markup).not.toContain("ana.webp");
  });
});
