import type { DivisionGridActivationReadiness } from "@/types/workspace.types";

import { bandsCoverLadder, RANK_COUNT, type Band } from "./draftReducer";

export interface PublishCheck {
  key: string;
  label: string;
  ok: boolean;
  /** A failing advisory is worth saying and does not stop a publish. */
  blocking: boolean;
}

export interface PublishCheckInput {
  bands: Band[];
  readiness: DivisionGridActivationReadiness | null;
  /** Mapping rows with no primary target yet, from `unresolvedRows`. */
  unresolvedMappings: number;
  /** `false` until the draft has been saved and its tiers have ids. */
  mappable: boolean;
  dirty: boolean;
}

/**
 * The pre-flight list behind "Ready to publish?" — and the Publish button's
 * enablement.
 *
 * One computation, two consumers: the panel renders these lines and the button
 * is disabled by the same blocking set, so the reason a publish is refused is
 * always visible next to the disabled button rather than only in a toast after
 * the request fails.
 *
 * Contiguity is checked rather than assumed even though the reducer makes it
 * structural: it costs one pass over 45 ranks and it is the one invariant whose
 * breach would corrupt every player's division silently.
 */
export function publishChecks({
  bands,
  readiness,
  unresolvedMappings,
  mappable,
  dirty
}: PublishCheckInput): PublishCheck[] {
  const names = bands.map((band) => band.name.trim().toLowerCase());
  const namesUnique = new Set(names).size === names.length && names.every((name) => name !== "");
  const borrowed = bands.filter((band) => band.icon_url === null).length;
  const incomplete = readiness
    ? readiness.incomplete_mapping_version_ids.length + readiness.missing_mapping_version_ids.length
    : 0;

  return [
    {
      key: "contiguous",
      label: `Every one of the ${RANK_COUNT} OW ranks belongs to exactly one division`,
      ok: bandsCoverLadder(bands),
      blocking: true
    },
    {
      key: "names",
      label: `All ${bands.length} names are set and unique`,
      ok: namesUnique,
      blocking: true
    },
    {
      key: "saved",
      label: "The draft is saved as a version",
      ok: !dirty,
      blocking: true
    },
    {
      key: "crests",
      label:
        borrowed === 0
          ? "Every division has its own crest"
          : `${borrowed} ${borrowed === 1 ? "division" : "divisions"} still borrow a ladder crest`,
      ok: borrowed === 0,
      blocking: false
    },
    {
      key: "mappings",
      label:
        unresolvedMappings + incomplete === 0
          ? "Every older version maps onto this one"
          : `${unresolvedMappings + incomplete} mapping ${
              unresolvedMappings + incomplete === 1 ? "decision" : "decisions"
            } left in the Mappings tab`,
      // Before the first save there is nothing to map onto, and the "saved"
      // check above already reports that — this line must not double as a
      // second complaint about the same thing.
      ok: mappable ? unresolvedMappings + incomplete === 0 : false,
      blocking: true
    }
  ];
}

/** Whether the draft may be published at all — the blocking checks, all passing. */
export function readyToPublish(checks: PublishCheck[]): boolean {
  return checks.every((check) => check.ok || !check.blocking);
}
