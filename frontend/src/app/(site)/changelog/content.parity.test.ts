import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { RELEASES } from "@/lib/changelog/releases";

const CONTENT = join(import.meta.dirname, "_content");
const PUBLIC = join(import.meta.dirname, "..", "..", "..", "..", "public");
const LOCALES = ["ru", "en"] as const;

describe("changelog content", () => {
  // A missing file is not a build error: the entry import is runtime-selected,
  // so a release written in one language only crashes for readers of the other.
  it("every release has an MDX file in both locales", () => {
    const expected = LOCALES.flatMap((locale) => RELEASES.map((release) => `${locale}/${release.version}.mdx`));
    expect(expected.filter((path) => !existsSync(join(CONTENT, path)))).toEqual([]);
  });

  // A screenshot path is a string to MDX: a typo renders a broken image, not an error.
  it("every screenshot an entry shows exists under public/", () => {
    const shots = LOCALES.flatMap((locale) =>
      readdirSync(join(CONTENT, locale))
        .filter((file) => file.endsWith(".mdx"))
        .flatMap((file) => readFileSync(join(CONTENT, locale, file), "utf8").match(/\/changelog\/[^\s"'`]+?\.webp/g) ?? [])
    );
    expect(shots.length).toBeGreaterThan(0);
    expect(shots.filter((src) => !existsSync(join(PUBLIC, src)))).toEqual([]);
  });
});
