"use client";

import { ExternalLink, Radio } from "lucide-react";
import { useTranslations } from "next-intl";

import { SocialIcon } from "@/components/social/SocialIcon";
import { TwitchEmbed } from "@/components/stream/TwitchEmbed";
import { getSocialProviderConfig } from "@/lib/social-providers";
import {
  extractTwitchChannel,
  getStreamStatus,
  STREAM_STATUS_META
} from "@/lib/stream-platform";
import { cn } from "@/lib/utils";
import type { StreamEntry, TournamentStreams } from "@/types/stream.types";

type TournamentBroadcastBlockProps = {
  /** The tournament's streams, or `undefined` while the read is in flight. */
  streams: TournamentStreams | undefined;
  className?: string;
};

/**
 * The Twitch login this entry can be embedded with, or `null` when it cannot be
 * embedded at all.
 *
 * Embeddability is asked of `STREAM_STATUS_META` rather than re-derived from
 * `live === true` here, so the rule stays in the one registry that also decides
 * the pill. The channel prefers what the poller stamped and falls back to the
 * URL, because an official link the organizer typed may be all there is (a
 * `tournament_link` row that no Helix response has matched yet carries the URL
 * but no login).
 */
function embeddableTwitchChannel(entry: StreamEntry): string | null {
  if (!STREAM_STATUS_META[getStreamStatus(entry.live)].embeddable) {
    return null;
  }
  if (entry.platform !== "twitch") {
    return null;
  }
  return entry.channel.trim() || extractTwitchChannel(entry.url);
}

/**
 * What to call the platform in "Watch on …". A known provider is named from the
 * shared catalog; anything else is named by its host, because the catalog's
 * fallback label for an unknown key would render the literal word "Other".
 */
function platformLabel(entry: StreamEntry): string {
  if (entry.platform !== "other") {
    return getSocialProviderConfig(entry.platform).label;
  }
  try {
    return new URL(entry.url).hostname.replace(/^www\./, "");
  } catch {
    return entry.channel;
  }
}

/**
 * The tournament's official broadcast, on every section of the page.
 *
 * It is persistent by design: a spectator who came to watch should not have to
 * find a tab first, and moving between Bracket and Standings must not tear down
 * a playing frame.
 *
 * ## Why the badge here is not the hero's status pill
 *
 * `PageHero` already shows a live pill for the TOURNAMENT's status. This one
 * reports something else entirely — whether the CHANNEL is currently
 * broadcasting — and the two disagree routinely: a tournament is `live` for
 * hours while the stream drops between series. So the copy names its subject
 * ("Channel is live") instead of repeating the hero's bare "Live", while the
 * pill classes still come from `STREAM_STATUS_META` so the site keeps one
 * visual language for liveness.
 *
 * Offline or unembeddable broadcasts keep their link: a YouTube or VK link has
 * no live detection at all (`live === null`), and hiding it would lose the only
 * way to reach the broadcast.
 */
export function TournamentBroadcastBlock({ streams, className }: TournamentBroadcastBlockProps) {
  const t = useTranslations();
  const official = streams?.official ?? [];

  if (official.length === 0) {
    return null;
  }

  // One player, for the first broadcast that can carry one. An organizer with
  // two simultaneously live official channels is not a case worth a switcher;
  // the rest stay reachable as links below.
  const featured = official.find((entry) => embeddableTwitchChannel(entry) !== null) ?? official[0];
  const featuredChannel = embeddableTwitchChannel(featured);
  const featuredStatus = getStreamStatus(featured.live);
  const featuredMeta = STREAM_STATUS_META[featuredStatus];
  const secondary = official.filter((entry) => entry !== featured);

  return (
    <div className={cn("aqt-card-surface", className)}>
      <div className="aqt-card-head">
        <h2 className="aqt-card-title">
          <span className="aqt-card-title-ic">
            <Radio className="size-4" aria-hidden />
          </span>
          {t("stream.broadcast.heading")}
        </h2>
        {featuredMeta.labelKey ? (
          <span className={cn(featuredMeta.pillClassName, "shrink-0")}>
            {featuredMeta.hasDot ? <span aria-hidden className="dot" /> : null}
            {featuredStatus === "live"
              ? t("stream.broadcast.channelLive")
              : t("stream.broadcast.channelOffline")}
          </span>
        ) : null}
      </div>

      <div className="aqt-card-body">
        {featuredChannel ? (
          <TwitchEmbed
            channel={featuredChannel}
            title={t("stream.broadcast.playerLabel", { channel: featuredChannel })}
          />
        ) : (
          <a
            href={featured.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center gap-2 rounded-[9px] border border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-overlay-3)] px-3 py-2 text-[13px] font-semibold text-inherit no-underline outline-none transition hover:text-[color:var(--aqt-teal)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--aqt-teal)]"
          >
            <SocialIcon provider={featured.platform} size={14} />
            <span>{t("stream.broadcast.watchOn", { platform: platformLabel(featured) })}</span>
            <ExternalLink className="size-3.5 opacity-70" aria-hidden />
          </a>
        )}

        {featured.title ? (
          <p className="mt-2.5 mb-0 text-[13px] text-[color:var(--aqt-fg-muted)]">
            {featured.title}
          </p>
        ) : null}

        {secondary.length > 0 ? (
          <ul
            aria-label={t("stream.broadcast.moreLinks")}
            className="mt-2.5 flex list-none flex-wrap gap-2 p-0"
          >
            {secondary.map((entry) => (
              <li key={entry.url}>
                <a
                  href={entry.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-[7px] border border-[color:var(--aqt-border-2)] px-2 py-1 text-[12.5px] font-medium text-inherit no-underline outline-none transition hover:text-[color:var(--aqt-teal)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--aqt-teal)]"
                >
                  <SocialIcon provider={entry.platform} size={12} />
                  <span>{entry.channel || platformLabel(entry)}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

export default TournamentBroadcastBlock;
