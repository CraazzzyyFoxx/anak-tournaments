"use client";

import type { ReactNode } from "react";
import { RotateCw } from "lucide-react";
import { useTranslations } from "next-intl";

import { DisciplineWidget } from "@/disciplines/DisciplineWidget";
import { loadProfileUI } from "@/disciplines/registry/profile";
import type { ProfileSlot, SlotProps } from "@/disciplines/types";
import { useDisciplineMetadata } from "@/hooks/useDisciplineMetadata";
import type { WorkspaceAxis } from "@/lib/site/discipline-scope";

/**
 * One player-profile slot of the profile's game: its module's renderer when the game has one, else `fallback`
 * (the working generic view). The game's metadata is a required read on the axis the host names (the viewed
 * workspace, tenant host included; a dossier its tournament's own) — nothing is drawn while it loads, and a
 * failed read says so with a retry instead of guessing another game's presentation.
 */
export default function ProfileWidget<K extends ProfileSlot>({
  axis,
  discipline,
  slot,
  props,
  fallback
}: Readonly<{
  axis: WorkspaceAxis;
  discipline: string;
  slot: K;
  props: Omit<SlotProps[K], "metadata">;
  fallback: ReactNode;
}>) {
  const t = useTranslations("common");
  const metadata = useDisciplineMetadata(axis, discipline);
  if (metadata.isPending) return null;
  if (metadata.isError) {
    return (
      <p role="alert" className="flex items-center gap-2 text-caption text-[color:var(--aqt-rose)]">
        {t("loadError")}
        <button
          type="button"
          disabled={metadata.isFetching}
          onClick={() => void metadata.refetch()}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[color:var(--aqt-fg-muted)] hover:bg-[color:var(--aqt-overlay-2)] disabled:opacity-50"
        >
          <RotateCw aria-hidden className="h-3 w-3" />
          {t("retry")}
        </button>
      </p>
    );
  }
  return (
    <DisciplineWidget
      discipline={discipline}
      load={loadProfileUI}
      slot={slot}
      capabilities={metadata.data.discipline.capabilities}
      props={{ ...props, metadata: metadata.data } as SlotProps[K]}
      fallback={fallback}
    />
  );
}
