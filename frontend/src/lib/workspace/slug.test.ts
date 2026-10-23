import { describe, expect, it } from "vitest";

import { suggestSlug, validateSlug } from "./slug";

describe("suggestSlug", () => {
  it("transliterates Cyrillic and collapses separators", () => {
    expect(suggestSlug("Весёлый  Кубок 2026")).toBe("vesyolyy-kubok-2026");
  });

  it("strips diacritics and trims edge hyphens", () => {
    expect(suggestSlug("  Café — Liga!  ")).toBe("cafe-liga");
  });

  it("keeps a legal slug untouched", () => {
    expect(suggestSlug("funny_cup-2")).toBe("funny_cup-2");
  });
});

describe("validateSlug", () => {
  it("accepts a legal address", () => {
    expect(validateSlug("funny-cup")).toBeNull();
  });

  it("names the first rule a slug breaks", () => {
    expect(validateSlug("")).toBe("empty");
    expect(validateSlug("Funny Cup")).toBe("format");
    expect(validateSlug("-cup")).toBe("edges");
    expect(validateSlug("admin")).toBe("reserved");
    expect(validateSlug("a".repeat(65))).toBe("length");
  });
});
