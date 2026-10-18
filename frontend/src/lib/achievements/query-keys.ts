import type { KeyPart } from "@/lib/query-keys";

/**
 * Keys for achievements on both sides of the wall: the public catalogue and the
 * organizer's rule editor (rooted at `admin` because that is the surface the
 * rule mutations already invalidate). They live in one file because a rule edit
 * stales the public list, and a key spelled twice is a list that never updates.
 *
 * Every collection and every piece of engine metadata is keyed by `discipline`:
 * two games share a workspace, rule slugs and endpoints, so a key without it is a
 * cache entry one game fills and the other reads. Rule-id keys keep the
 * authorized workspace and rule id — a rule's id already names exactly one game.
 */
export const achievementQueryKeys = {
  users: (achievementId: KeyPart, scope: KeyPart, page: KeyPart) =>
    ["achievement", "users", achievementId, scope, page] as const,
  /** The public catalogue; `discipline: null` is every game (the cross-game list). */
  all: (workspaceId: KeyPart, discipline: KeyPart) => ["achievements", "all", workspaceId, discipline] as const,
  /** Prefix of every public catalogue list, whatever its workspace scope or game filter. */
  publicLists: () => ["achievements", "all"] as const,
  conditionTypes: (workspaceId: KeyPart, discipline: KeyPart) =>
    ["admin", "achievement-condition-types", workspaceId, discipline] as const,
  libraryRules: (workspaceId: KeyPart, sourceWorkspaceId: KeyPart, discipline: KeyPart) =>
    ["admin", "achievement-library-rules", workspaceId, sourceWorkspaceId, discipline] as const,
  /** The character catalog a rule of this game links into, as the workspace's editors read it. */
  entities: (workspaceId: KeyPart, discipline: KeyPart) =>
    ["admin", "achievement-entities", workspaceId, discipline] as const,
  libraryWorkspaces: (workspaceId: KeyPart, discipline: KeyPart) =>
    ["admin", "achievement-library-workspaces", workspaceId, discipline] as const,
  ruleUsersPage: (workspaceId: KeyPart, ruleId: KeyPart, tournamentId: KeyPart, sort: KeyPart, order: KeyPart) =>
    ["admin", "achievement-rule-users", workspaceId, ruleId, tournamentId, sort, order] as const,
  ruleUsers: (workspaceId: KeyPart, ruleId: KeyPart) =>
    ["admin", "achievement-rule-users", workspaceId, ruleId] as const,
  rule: (workspaceId: KeyPart, ruleId: KeyPart) =>
    ["admin", "achievement-rule", workspaceId, ruleId] as const,
  adminList: (workspaceId: KeyPart, discipline: KeyPart) =>
    ["admin", "achievements", workspaceId, discipline] as const,
  /** Every workspace's rule list of every game: the prefix a cross-game mutation (e.g. a file import) stales. */
  adminListsOf: (workspaceId: KeyPart) => ["admin", "achievements", workspaceId] as const,
  overrides: (workspaceId: KeyPart, ruleId: KeyPart) =>
    ["admin", "overrides", workspaceId, ruleId] as const,
  overridesAll: (workspaceId: KeyPart, discipline: KeyPart) =>
    ["admin", "overrides", workspaceId, "all", discipline] as const,
};
