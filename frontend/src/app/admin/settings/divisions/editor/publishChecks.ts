import type { DivisionGridActivationReadiness } from "@/types/workspace.types";

import {
  bandsCoverLadder,
  bandsMissingCrest,
  floorsDescend,
  unlinkedRanks,
  type Band,
  type Ladder,
  type Scale
} from "./draftReducer";

type PublishCheckMessageKey =
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
  | "impactChecks.crestsRequired"
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
  /** The discipline's native ladder; `null` when it declares none (no native coverage to check). */
  ladder: Ladder | null;
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
 * With a native ladder its coverage is checked rather than assumed on both
 * scales: a rank no division takes is a player whose collected snapshot
 * silently resolves to nothing, and a ladder band out of place would re-band
 * every player. Without one there is no native coverage to check, and the
 * crest is mandatory: there is no ladder to borrow one from and the server
 * refuses a tier without it.
 */
export function publishChecks({
  ladder,
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
  const crestless = bandsMissingCrest(ladder, bands).length;
  const incomplete = readiness
    ? readiness.incomplete_mapping_version_ids.length + readiness.missing_mapping_version_ids.length
    : 0;
  const open = unresolvedMappings + incomplete;

  const floors: PublishCheck = {
    key: "floors",
    messageKey: "impactChecks.floors",
    ok: floorsDescend(bands),
    blocking: true
  };
  let coverage: PublishCheck[];
  if (!ladder) {
    coverage = [floors];
  } else if (scale === "ladder") {
    coverage = [
      {
        key: "coverage",
        messageKey: "impactChecks.coverageAll",
        values: { count: ladder.count },
        ok: bandsCoverLadder(ladder, bands),
        blocking: true
      }
    ];
  } else {
    const gaps = unlinkedRanks(ladder, bands).length;
    const unlinked = bands.filter((band) => band.native === null).length;
    coverage = [
      floors,
      {
        key: "coverage",
        messageKey: gaps === 0 ? "impactChecks.coverageLinked" : "impactChecks.gaps",
        values: { count: gaps || ladder.count },
        ok: gaps === 0,
        blocking: true
      },
      {
        key: "unlinked",
        messageKey: unlinked === 0 ? "impactChecks.unlinked" : "impactChecks.unlinkedSome",
        values: { count: unlinked },
        ok: unlinked === 0,
        blocking: false
      }
    ];
  }

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
    ladder
      ? {
          key: "crests",
          messageKey: borrowed === 0 ? "impactChecks.crests" : "impactChecks.crestsSome",
          values: { count: borrowed },
          ok: borrowed === 0,
          blocking: false
        }
      : {
          key: "crests",
          messageKey: crestless === 0 ? "impactChecks.crests" : "impactChecks.crestsRequired",
          values: { count: crestless },
          ok: crestless === 0,
          blocking: true
        },
    {
      key: "mappings",
      messageKey: open === 0 ? "impactChecks.mappings" : "impactChecks.mappingsSome",
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
