import type { KeyPart } from "@/lib/query-keys";

/**
 * Keys for division grids: the grid list, its versions, the readiness report and
 * the cross-workspace importer.
 *
 * A workspace holds independent grids per discipline, so every key whose payload
 * depends on one game's active version carries that `discipline` — an activation
 * in one game then refreshes only that game's `*ByDiscipline` prefixes, never
 * another game's cached versions or readiness. The grid list itself spans the
 * workspace's disciplines (each entry names its own), and a version id already
 * identifies its game, so those keys do not repeat it.
 */
export const divisionGridQueryKeys = {
  importGrids: (workspaceId: KeyPart, sourceWorkspaceId: KeyPart) =>
    ["division-grid-import-grids", workspaceId, sourceWorkspaceId] as const,
  importJob: (workspaceId: KeyPart, jobId: KeyPart) =>
    ["division-grid-import-job", workspaceId, jobId] as const,
  importPreflight: (workspaceId: KeyPart, request: unknown) =>
    ["division-grid-import-preflight", workspaceId, request] as const,
  importWorkspaces: (workspaceId: KeyPart) =>
    ["division-grid-import-workspaces", workspaceId] as const,
  mapping: (sourceVersionId: KeyPart, versionId: KeyPart) =>
    ["division-grid-mapping", sourceVersionId, versionId] as const,
  readiness: (workspaceId: KeyPart, discipline: KeyPart, versionId: KeyPart) =>
    ["division-grid-readiness", workspaceId, discipline, versionId] as const,
  readinessByDiscipline: (workspaceId: KeyPart, discipline: KeyPart) =>
    ["division-grid-readiness", workspaceId, discipline] as const,
  version: (versionId: KeyPart) => ["division-grid-version", versionId] as const,
  versions: (workspaceId: KeyPart, discipline: KeyPart, gridId: KeyPart) =>
    ["division-grid-versions", workspaceId, discipline, gridId] as const,
  versionsByDiscipline: (workspaceId: KeyPart, discipline: KeyPart) =>
    ["division-grid-versions", workspaceId, discipline] as const,
  grids: (workspaceId: KeyPart) => ["division-grids", workspaceId] as const
};
