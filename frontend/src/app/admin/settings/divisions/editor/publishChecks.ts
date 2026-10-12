import type { DivisionGridActivationReadiness } from "@/types/workspace.types";

import {
  bandsCoverLadder,
  floorsDescend,
  RANK_COUNT,
  unlinkedRanks,
  type Band,
  type Scale
} from "./draftReducer";

export type PublishCheckMessageKey =
  | "impactChecks.coverageAll"
  | "impactChecks.floors"
  | "impactChecks.coverageLinked"
  | "impactChecks.gaps"
  | "impactChecks.unlinked"
  | "impactChecks.unlinkedSome"
  | "impactChecks.names"
  | "impactChecks.saved"
  | "impactChecks.crests"
  | "impactChecks.crestsSome"
  | "impactChecks.mappings"
  | "impactChecks.mappingsSome"

export interface PublishCheck {
  key: string;
  messageKey: PublishCheckMessageKey;
  values?: Record<string, string | number>;
  ok: boolean;
  /** A failing advisory is worth saying and does not stop a publish. */
  blocking: boolean;
}

export interface PublishCheckInput {
  bands: Band[];
  scale: Scale;
  readiness: DivisionGridActivationReadiness | null;
  /** Mapping rows with no primary target yet, from `unresolvedRows`. */
  unresolvedMappings: number;
  /** `false` until the draft has been saved and its tiers have ids. */
  mappable: boolean;
  dirty: boolean;
}

/**
 * The pre-flight list behind "Ready to publish?" — and the Publish button's
 * enablement. One computation, two consumers, so the reason a publish is
 * refused is always on screen next to the disabled button.
 *
 * The OW coverage is checked rather than assumed on both scales: a rank no
 * division takes is a player whose OverFast snapshot silently resolves to
 * nothing, and a ladder band out of place would re-band every player.
 */
export function publishChecks({
  bands,
  scale,
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
  const open = unresolvedMappings + incomplete;
  const gaps = unlinkedRanks(bands).length;
  const unlinked = bands.filter((band) => band.ow === null).length;

  const coverage: PublishCheck[] =
    scale === "ladder"
      ? [
          {
            key: "coverage",
            messageKey: "impactChecks.coverageAll",
            values: { count: RANK_COUNT },
            ok: bandsCoverLadder(bands),
            blocking: true
          }
        ]
      : [
          {
            key: "floors",
            messageKey: "impactChecks.floors",
            ok: floorsDescend(bands),
            blocking: true
          },
          {
            key: "coverage",
            messageKey:
              gaps === 0
                ? "impactChecks.coverageLinked"
                : "impactChecks.gaps",
            values: { count: gaps || RANK_COUNT },
            ok: gaps === 0,
            blocking: true
          },
          {
            key: "unlinked",
            messageKey:
              unlinked === 0
                ? "impactChecks.unlinked"
                : "impactChecks.unlinkedSome",
            values: { count: unlinked },
            ok: unlinked === 0,
            blocking: false
          }
        ];

  return [
    ...coverage,
    {
      key: "names",
      messageKey: "impactChecks.names",
      values: { count: bands.length },
      ok: namesUnique,
      blocking: true
    },
    {
      key: "saved",
      messageKey: "impactChecks.saved",
      ok: !dirty,
      blocking: true
    },
    {
      key: "crests",
      messageKey:
        borrowed === 0
          ? "impactChecks.crests"
          : "impactChecks.crestsSome",
      values: { count: borrowed },
      ok: borrowed === 0,
      blocking: false
    },
    {
      key: "mappings",
      messageKey:
        open === 0
          ? "impactChecks.mappings"
          : "impactChecks.mappingsSome",
      values: { count: open },
      // Before the first save there is nothing to map onto, and the "saved"
      // check above already reports that.
      ok: mappable ? open === 0 : false,
      blocking: true
    }
  ];
}

/** Whether the draft may be published at all — the blocking checks, all passing. */
export function readyToPublish(checks: PublishCheck[]): boolean {
  return checks.every((check) => check.ok || !check.blocking);
}
