import type {
  AchievementRule,
  AchievementRuleCreateInput,
  AchievementRuleUpdateInput,
} from "@/types/admin.types";

/**
 * A fresh create form of one game. There is no module-level default object: a
 * rule's discipline is immutable and has no sensible default, so the caller has
 * to name the game the form belongs to.
 */
export function emptyAchievementForm(discipline: string): AchievementRuleCreateInput {
  return {
    slug: "",
    name: "",
    description_ru: "",
    description_en: "",
    discipline,
    entity_id: null,
    category: "overall",
    scope: "global",
    grain: "user",
    condition_tree: {},
    depends_on: [],
    enabled: true,
  };
}

/**
 * The editable half of a rule. Key order matters: the dirty check is a
 * `JSON.stringify` comparison against the form state, which is built by
 * spreading this same object. `discipline` is deliberately absent: it is the
 * rule's own and immutable, so an edit can neither carry nor change it.
 */
export function achievementFormData(rule: AchievementRule): AchievementRuleUpdateInput {
  return {
    name: rule.name,
    description_ru: rule.description_ru,
    description_en: rule.description_en,
    image_url: rule.image_url,
    entity_id: rule.entity_id,
    category: rule.category,
    scope: rule.scope,
    grain: rule.grain,
    condition_tree: rule.condition_tree,
    depends_on: rule.depends_on,
    enabled: rule.enabled,
    min_tournament_id: rule.min_tournament_id,
  };
}

/** The list dialog also shows the slug — read-only when editing, but part of the form. */
export function achievementFormDataWithSlug(rule: AchievementRule): AchievementRuleUpdateInput {
  return { slug: rule.slug, ...achievementFormData(rule) };
}

/** How many actual predicates a condition tree holds, ignoring the logic wrapping them. */
export function countLeafConditions(node: Record<string, unknown>): number {
  if (node.AND) return (node.AND as Record<string, unknown>[]).reduce((s, c) => s + countLeafConditions(c), 0);
  if (node.OR) return (node.OR as Record<string, unknown>[]).reduce((s, c) => s + countLeafConditions(c), 0);
  if (node.NOT) return countLeafConditions(node.NOT as Record<string, unknown>);
  return 1;
}

export function groupRulesByCategory(rules: AchievementRule[]): Record<string, AchievementRule[]> {
  return rules.reduce<Record<string, AchievementRule[]>>((acc, rule) => {
    (acc[rule.category] ??= []).push(rule);
    return acc;
  }, {});
}
