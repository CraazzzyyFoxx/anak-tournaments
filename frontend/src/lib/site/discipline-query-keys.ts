import type { WorkspaceAxis } from "@/lib/site/discipline-scope";

/** Metadata of the installed games for one workspace axis. `all` and a concrete id are different entries. */
export const disciplineQueryKeys = {
  list: (axis: WorkspaceAxis) => ["disciplines", axis] as const,
  metadata: (axis: WorkspaceAxis, code: string) => ["discipline-metadata", axis, code] as const,
};
