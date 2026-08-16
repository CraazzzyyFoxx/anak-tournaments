import Link from "next/link";
import { useTranslations } from "next-intl";

import { SocialIcon } from "@/components/social/SocialIcon";
import { getSocialProviderConfig } from "@/lib/social-providers";
import { getStreamStatus, STREAM_STATUS_META } from "@/lib/stream-platform";
import { hexToRgba } from "@/lib/utils";
import type { StreamEntry } from "@/types/stream.types";
import { getPlayerSlug } from "@/utils/player";

interface StreamCardProps {
  entry: StreamEntry;
  className?: string;
}

/**
 * One stream channel: preview, title, viewers, live pill and whose channel it
 * is.
 *
 * Live status uses the semantic `.status-pill.{variant}` classes from
 * `globals.css` (scoped by `.aqt-tn`, which the public tournament shell already
 * carries) rather than `ui/badge.tsx` — that component belongs to the admin and
 * analytics surfaces.
 */
export function StreamCard({ entry, className }: StreamCardProps) {
  const t = useTranslations();
  const status = getStreamStatus(entry.live);
  const meta = STREAM_STATUS_META[status];
  const provider = getSocialProviderConfig(entry.platform);

  // Provider-tinted chip, same construction as `SocialAccountBadge`: `hexToRgba`
  // returns null for a non-6-digit hex instead of emitting invalid CSS, and the
  // label is lifted toward white because raw brand hues (Twitch #9146ff → 4.01:1)
  // fail WCAG AA as small text on our dark surfaces.
  const chipSurface = hexToRgba(provider.color, 0.0625);
  const chipBorder = hexToRgba(provider.color, 0.25);
  const chipLabelColor = `color-mix(in srgb, ${provider.color} 80%, white)`;

  return (
    <article
      className={
        className ??
        "flex flex-col overflow-hidden rounded-[12px] border border-[color:var(--aqt-border)] bg-[color:var(--aqt-card)]"
      }
    >
      {entry.thumbnail_url ? (
        // Plain <img>, not next/image: `next.config.mjs` sets `images.unoptimized`,
        // so the optimizer never runs and a `remotePatterns` entry for
        // static-cdn.jtvnw.net would buy nothing but a config diff. Decorative —
        // the title below is the accessible name.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={entry.thumbnail_url}
          alt=""
          aria-hidden
          loading="lazy"
          className="aspect-video w-full object-cover"
        />
      ) : null}

      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          {/* The card deliberately does NOT navigate from an onClick on the
              <article> (unreachable by keyboard, no announced target) and does
              not use a stretched overlay (it would swallow the footer links).
              The title carries the link — same resolution as FeaturedLive. */}
          <h3 className="m-0 min-w-0 text-[13.5px] font-semibold leading-snug">
            <a
              href={entry.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-inherit no-underline outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--aqt-teal)]"
              title={entry.title ?? entry.channel}
            >
              {entry.title ?? entry.channel}
            </a>
          </h3>
          {meta.labelKey ? (
            <span className={`${meta.pillClassName} shrink-0`}>
              {meta.hasDot ? <span aria-hidden className="dot" /> : null}
              {t(meta.labelKey)}
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-[7px] border px-2 py-1 text-[12.5px] font-medium"
            style={{
              background: chipSurface ?? undefined,
              borderColor: chipBorder ?? "var(--aqt-border-2)",
              color: chipLabelColor,
            }}
            title={provider.label}
          >
            <SocialIcon provider={entry.platform} size={12} />
            <span>{entry.channel}</span>
          </span>
          {entry.game_name ? (
            <span className="text-[12px] text-[color:var(--aqt-fg-muted)]">{entry.game_name}</span>
          ) : null}
          {entry.viewer_count != null ? (
            <span className="text-[12px] text-[color:var(--aqt-fg-muted)]">
              {t("draft.presence.watching", { count: entry.viewer_count })}
            </span>
          ) : null}
        </div>

        {entry.player ? (
          // The team is a caption ON the player, not a row of its own: a bare
          // team name under the card reads as a second, unrelated subject. It
          // stays plain text because there is no team detail route to link to —
          // `(site)/teams` is a list page and takes no id.
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              href={`/users/${getPlayerSlug(entry.player.name)}`}
              className="inline-flex w-fit items-center gap-2 text-[12.5px] font-semibold text-inherit no-underline outline-none hover:text-[color:var(--aqt-teal)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--aqt-teal)]"
            >
              {entry.player.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={entry.player.avatar_url}
                  alt=""
                  aria-hidden
                  loading="lazy"
                  width={20}
                  height={20}
                  className="size-5 rounded-full object-cover"
                />
              ) : null}
              <span className="truncate">{entry.player.name}</span>
            </Link>
            {/* No team is the ordinary state before the balancer forms rosters,
                so it renders nothing at all — an empty caption or a dash would
                claim the roster exists and is blank. */}
            {entry.player.team ? (
              <span className="truncate text-[12px] text-[color:var(--aqt-fg-muted)]">
                {t("stream.card.team", { team: entry.player.team.name })}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
