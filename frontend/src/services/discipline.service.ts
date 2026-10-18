import { apiFetch } from "@/lib/api/fetch";
import type { WorkspaceAxis } from "@/lib/site/discipline-scope";
import type { DisciplineDescriptor, DisciplineMetadata } from "@/types/discipline.types";

/**
 * Native discipline metadata. The workspace axis is always sent explicitly —
 * `all` as the sentinel, never an omitted parameter — so the gateway's ambient
 * credential/cookie default cannot pick a different scope than the cache key names.
 */
export default class disciplineService {
  static async list(axis: WorkspaceAxis, opts: { signal?: AbortSignal } = {}): Promise<DisciplineDescriptor[]> {
    return apiFetch("/api/v1/disciplines", { query: { workspace_id: axis }, signal: opts.signal }).then((res) =>
      res.json()
    );
  }

  static async metadata(
    axis: WorkspaceAxis,
    code: string,
    opts: { signal?: AbortSignal } = {}
  ): Promise<DisciplineMetadata> {
    return apiFetch(`/api/v1/disciplines/${encodeURIComponent(code)}/metadata`, {
      query: { workspace_id: axis },
      signal: opts.signal,
    }).then((res) => res.json());
  }
}
