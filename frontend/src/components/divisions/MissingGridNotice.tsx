"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { ApiError } from "@/lib/api/error";

/**
 * True for the server's `division_grid_required` refusal (422): the workspace has no published grid with
 * tiers for the game the request is about, so nothing may silently balance or rank on another game's
 * ladder. Callers that surface such an error render {@link MissingGridNotice} instead of a raw message.
 */
export function isDivisionGridRequired(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 422 &&
    error.details.some(
      (detail) => detail.code === "division_grid_required" || detail.msg.startsWith("division_grid_required")
    )
  );
}

/**
 * The state behind a missing-grid refusal: an organizer gets the way out (create or select a grid of
 * THIS game in THIS workspace, with the game preselected); anyone else gets a plain message — never a link
 * that would bypass the permission it needs. Across communities no workspace grid applies, so that view
 * says so and points at choosing a community instead of at an organizer.
 */
export function MissingGridNotice({
  discipline,
  gameName,
  canManage,
  acrossCommunities = false
}: Readonly<{ discipline: string; gameName: string; canManage: boolean; acrossCommunities?: boolean }>) {
  const t = useTranslations("common.discipline");
  if (acrossCommunities) {
    return (
      <div role="alert" className="rounded-xl border border-border bg-card p-3 text-sm">
        <p className="text-muted-foreground">{t("gridMissingAcross", { game: gameName })}</p>
      </div>
    );
  }
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 text-sm">
      <p className="text-muted-foreground">{t("gridMissing")}</p>
      {canManage ? (
        <Link
          className="self-start font-medium text-primary underline-offset-4 hover:underline"
          href={`/admin/settings/divisions?discipline=${encodeURIComponent(discipline)}`}
        >
          {t("gridMissingAction", { game: gameName })}
        </Link>
      ) : (
        <p>{t("gridMissingOrganizer", { game: gameName })}</p>
      )}
    </div>
  );
}
