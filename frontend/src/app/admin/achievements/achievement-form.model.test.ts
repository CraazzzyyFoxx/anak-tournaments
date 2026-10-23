import { describe, expect, it } from "vitest";

import type { AchievementRule } from "@/types/admin.types";

import { achievementFormData, achievementFormDataWithSlug, emptyAchievementForm } from "./achievement-form.model";
import { portableFileProblem } from "./achievement-import";

const RULE: AchievementRule = {
  id: 5,
  workspace_id: 7,
  slug: "ana-main",
  name: "Ana main",
  description_ru: "ru",
  description_en: "en",
  image_url: null,
  discipline: "lol",
  entity_id: 321,
  category: "hero",
  scope: "global",
  grain: "user",
  condition_tree: {},
  depends_on: [],
  enabled: true,
  rule_version: 1,
  min_tournament_id: null,
  created_at: "2026-10-18T00:00:00Z",
  updated_at: null,
};

describe("the achievement form", () => {
  it("starts from the game it is created for, with no entity", () => {
    expect(emptyAchievementForm("lol")).toMatchObject({ discipline: "lol", entity_id: null, slug: "" });
    expect(emptyAchievementForm("overwatch").discipline).toBe("overwatch");
  });

  it("builds every form from a call, never from a shared object", () => {
    const first = emptyAchievementForm("overwatch");
    first.depends_on?.push("leak");
    expect(emptyAchievementForm("overwatch").depends_on).toEqual([]);
  });

  it("keeps the rule's entity on an edit and never carries its immutable discipline", () => {
    const edit = achievementFormDataWithSlug(RULE);
    expect(edit.entity_id).toBe(321);
    expect(edit).not.toHaveProperty("discipline");
    expect(edit).not.toHaveProperty("hero_id");
    expect(achievementFormData({ ...RULE, entity_id: null }).entity_id).toBeNull();
  });
});

describe("a picked achievement file", () => {
  const rule = { slug: "a", discipline: "lol", entity_id: null };

  it("accepts portable v2", () => {
    expect(portableFileProblem({ schema_version: 2, rules: [rule] })).toBeNull();
  });

  it.each([1, undefined, "2", 3])("names unsupported format %s", (schema_version) => {
    expect(portableFileProblem({ schema_version, rules: [rule] })).toEqual({ kind: "version", version: schema_version });
  });

  it("names the retired hero_id with the rule that carries it", () => {
    expect(portableFileProblem({ schema_version: 2, rules: [rule, { slug: "old", hero_id: 3 }] })).toEqual({
      kind: "hero_id",
      slug: "old",
    });
  });

  it.each([null, [], "text", { schema_version: 2 }, { schema_version: 2, rules: "x" }])("rejects shape %j", (parsed) => {
    expect(portableFileProblem(parsed)).toEqual({ kind: "shape" });
  });
});
