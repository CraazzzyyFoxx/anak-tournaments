import { describe, expect, it } from "vitest";

import { formatAliasesInput, parseAliasesInput } from "@/lib/catalog-aliases";
import { hasUnsavedChanges } from "@/lib/form-change";

describe("catalog alias textarea parsing", () => {
  it("parses one alias per line, trimming and dropping blanks and duplicates", () => {
    expect(parseAliasesInput("Ана\n  アナ  \n\nАна\n")).toEqual(["Ана", "アナ"]);
  });

  it("keeps the author's order rather than sorting", () => {
    expect(parseAliasesInput("Ilios\nИлиос\nイリオス")).toEqual(["Ilios", "Илиос", "イリオス"]);
  });

  it("treats a whitespace-only value as no aliases at all", () => {
    expect(parseAliasesInput("")).toEqual([]);
    expect(parseAliasesInput("   \n\t\n  ")).toEqual([]);
  });

  it("strips the carriage return a Windows paste leaves behind", () => {
    expect(parseAliasesInput("Hanamura\r\nХанамура\r\n")).toEqual(["Hanamura", "Ханамура"]);
  });

  it("round-trips through the textarea value", () => {
    expect(formatAliasesInput(["Ана", "アナ"])).toBe("Ана\nアナ");
    expect(parseAliasesInput(formatAliasesInput(["Ана", "アナ"]))).toEqual(["Ана", "アナ"]);
  });
});

describe("alias edits mark the entity dialog dirty", () => {
  // `hasUnsavedChanges` compares JSON, so the alias field only registers when
  // both sides carry it in the same key position — that is why every page keeps
  // `aliases` in its empty-form constant AND in its edit-form builder.
  it("sees an alias appended to an entity that had none", () => {
    const initial = { name: "Ilios", aliases: [] as string[] };

    expect(hasUnsavedChanges({ ...initial }, initial)).toBe(false);
    expect(hasUnsavedChanges({ ...initial, aliases: ["Илиос"] }, initial)).toBe(true);
  });

  it("sees an alias removed from an entity that had one", () => {
    const initial = { name: "Ilios", aliases: ["Илиос"] };

    expect(hasUnsavedChanges({ ...initial, aliases: [] }, initial)).toBe(true);
  });

  it("catches a form whose alias field was never initialised", () => {
    // The failure mode the pages must avoid: `undefined` vs `[]` reads dirty on
    // open, so the discard prompt fires on a dialog nobody edited.
    expect(hasUnsavedChanges({ name: "Ilios" }, { name: "Ilios", aliases: [] })).toBe(true);
  });
});
