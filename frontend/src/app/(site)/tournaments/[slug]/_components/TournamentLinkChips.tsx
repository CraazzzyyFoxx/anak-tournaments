"use client";

import { FileText, Link2, ListVideo, Network } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ComponentType } from "react";

import { SocialIcon } from "@/components/social/SocialIcon";
import type { TournamentLink, TournamentLinkKind } from "@/types/stream.types";

type TournamentLinkChipsProps = {
  /** `tournament.links` — absent whenever the read did not ask for the entity. */
  links: TournamentLink[] | undefined;
  className?: string;
};

/** Message keys, spelled out because next-intl types reject a widened key. */
type ChipLabelKey =
  | "tournamentDetail.links.kinds.discord"
  | "tournamentDetail.links.kinds.vod"
  | "tournamentDetail.links.kinds.bracket"
  | "tournamentDetail.links.kinds.rules"
  | "tournamentDetail.links.kinds.other";

type ChipMeta = {
  labelKey: ChipLabelKey;
  /** `null` means "use the Discord brand mark" — lucide dropped brand glyphs, so
   *  that one comes from `SocialIcon` instead of this field. */
  icon: ComponentType<{ className?: string }> | null;
};

/**
 * Every link kind, keyed by kind rather than resolved through a chain of
 * ternaries — the reason `STREAM_STATUS_META` and `TOURNAMENT_STATUS_META` are
 * registries: a kind added to `TOURNAMENT_LINK_KINDS` on the backend then fails
 * the build here instead of rendering a raw enum token to spectators.
 *
 * `stream` maps to `null` — not omitted from the type, so this stays exhaustive
 * over the backend vocabulary, and not merely skipped at the call site. Official
 * broadcasts belong to `TournamentBroadcastDock`, which renders them with live
 * status and a player; a second copy here carrying neither would be worse than
 * their absence.
 */
const CHIP_META: Record<TournamentLinkKind, ChipMeta | null> = {
  stream: null,
  discord: { labelKey: "tournamentDetail.links.kinds.discord", icon: null },
  vod: { labelKey: "tournamentDetail.links.kinds.vod", icon: ListVideo },
  bracket: { labelKey: "tournamentDetail.links.kinds.bracket", icon: Network },
  rules: { labelKey: "tournamentDetail.links.kinds.rules", icon: FileText },
  other: { labelKey: "tournamentDetail.links.kinds.other", icon: Link2 },
};

/**
 * Everything around the event that is not the broadcast: the Discord invite, the
 * rules doc, an external bracket, VOD playlists.
 *
 * Ordered by `(sort_order, id)` — the same order the backend returns and the
 * organizer sets in the admin Links tab, mirrored here so a client-side sort can
 * never disagree with the table they were just looking at.
 */
export function TournamentLinkChips({ links, className }: Readonly<TournamentLinkChipsProps>) {
  const t = useTranslations();

  // `flatMap` rather than filter-then-index: it resolves the registry entry once
  // and carries it forward, so the render needs neither a second lookup nor a
  // cast to convince the compiler the entry is there.
  const chips = (links ?? [])
    .flatMap((link) => {
      const meta = link.is_active ? CHIP_META[link.kind] : null;
      return meta ? [{ link, meta }] : [];
    })
    .sort((a, b) => a.link.sort_order - b.link.sort_order || a.link.id - b.link.id);

  // Nothing at all rather than an empty heading: this is a public page, and "the
  // organizer has not added links" is not news a spectator came for. The admin
  // Links tab is where absence is worth stating.
  if (chips.length === 0) {
    return null;
  }

  return (
    <nav aria-label={t("tournamentDetail.links.heading")} className={className}>
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {chips.map(({ link, meta }) => {
          const Icon = meta.icon;
          return (
            <li key={link.id}>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                // Same chip as the dock's secondary broadcast links, so the two
                // sets of external links on this page read as one vocabulary.
                className="inline-flex items-center gap-1.5 rounded-[7px] border border-[color:var(--aqt-border-2)] px-2 py-1 text-[12.5px] font-medium text-inherit no-underline outline-none transition-colors hover:text-[color:var(--aqt-teal)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--aqt-teal)]"
              >
                {Icon ? (
                  <Icon className="size-3.5 opacity-80" aria-hidden />
                ) : (
                  <SocialIcon provider="discord" size={13} />
                )}
                {/* `label` is NULL-able with exactly this meaning (see the column
                    docstring): fall back to the kind's own name, never to the raw
                    URL, which would put a tracking query string on screen. */}
                <span>{link.label?.trim() || t(meta.labelKey)}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default TournamentLinkChips;
