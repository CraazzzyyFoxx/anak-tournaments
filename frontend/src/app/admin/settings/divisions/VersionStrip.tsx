"use client";

import Link from "next/link";

import { EYEBROW_CLASS, TONE_CLASS } from "@/components/admin/tone";
import { formatDate } from "@/components/admin/format-time";
import { cn } from "@/lib/utils";
import type { DivisionGridVersion } from "@/types/workspace.types";

import { VERSION_STATE_TONE, versionState } from "./versionStatus";

export interface VersionStripProps {
  versions: DivisionGridVersion[];
  activeVersionId: number | null;
  /**
   * Tournaments still reading a version, where that is known: the readiness
   * payload reports it for every version a tournament pins, which is every
   * version except the one being checked. Absent entries render as an em dash
   * rather than as a zero (backend gap G2).
   */
  tournamentCounts: Record<number, number>;
  editorHref: (versionId: number) => string;
}

/**
 * The version history of one grid, as a strip of cards (F11 ·3).
 *
 * This replaces the old `GridLibrary` list of *grids*: a workspace has one grid
 * as a rule, and what the user actually navigates is its versions. Ascending,
 * so the draft — the only card with anywhere to go — sits at the end where the
 * eye lands.
 */
export function VersionStrip({
  versions,
  activeVersionId,
  tournamentCounts,
  editorHref
}: Readonly<VersionStripProps>) {
  const ordered = [...versions].sort((left, right) => left.version - right.version);

  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {ordered.map((version) => {
        const state = versionState(version, activeVersionId);
        const count = tournamentCounts[version.id];
        const isDraft = version.status === "draft";

        return (
          <li
            key={version.id}
            className={cn(
              "flex flex-col gap-2 rounded-xl border bg-card p-3",
              state === "active" ? "border-primary/50" : "border-border",
              state === "archived" && "opacity-70"
            )}
          >
            <div className="flex items-center gap-2">
              <span className="font-display text-base font-semibold tabular-nums">
                v{version.version}
              </span>
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-xs font-medium",
                  TONE_CLASS[VERSION_STATE_TONE[state]]
                )}
              >
                {state}
              </span>
            </div>

            <p className="min-w-0 truncate text-sm font-medium">{version.label}</p>

            <p className={cn(EYEBROW_CLASS, "font-mono tabular-nums")}>
              {version.tiers.length} divisions
              {" · "}
              {count === undefined ? (
                <span title="No consumer count for this version yet — the readiness payload reports it only for versions a tournament still pins (backend gap G2).">
                  &mdash;
                </span>
              ) : (
                `${count} ${count === 1 ? "tournament" : "tournaments"}`
              )}
              {" · "}
              {isDraft ? "not published" : formatDate(version.published_at)}
            </p>

            {isDraft ? (
              <Link
                href={editorHref(version.id)}
                className="mt-auto inline-flex w-fit items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Open editor
                <span aria-hidden>&rarr;</span>
              </Link>
            ) : (
              <Link
                href={editorHref(version.id)}
                className="mt-auto inline-flex w-fit items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                View read-only
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
