"use client";

import { ExternalLink, Radio, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { SocialIcon } from "@/components/social/SocialIcon";
import { TwitchEmbed } from "@/components/stream/TwitchEmbed";
import {
  embeddableTwitchChannel,
  getStreamStatus,
  streamPlatformLabel
} from "@/lib/stream-platform";
import { cn } from "@/lib/utils";
import type { TournamentStreams } from "@/types/stream.types";

type TournamentBroadcastDockProps = {
  /** The tournament's streams, or `undefined` while the read is in flight. */
  streams: TournamentStreams | undefined;
  className?: string;
};

// Bottom-trailing, inset by the same 1rem the cookie banner uses, with the
// safe-area floor so the panel clears an iOS home indicator. Logical `end`, not
// `right`: the corner follows the writing direction.
const ANCHOR =
  "fixed bottom-4 end-4 z-40 supports-[padding:max(0px)]:mb-[max(0px,env(safe-area-inset-bottom))]";

/**
 * The tournament's official broadcast, docked in the bottom-trailing corner of
 * every section of the page.
 *
 * It is persistent by design: a spectator who came to watch should not have to
 * find a tab first, and moving between Bracket and Standings must not tear down
 * a playing frame.
 *
 * ## Why a floating dock and not a block in the flow
 *
 * This used to be a full-width card between the hero and the section nav — on
 * every tab. It pushed the actual content of Bracket, Standings and Matches
 * below the fold to show a frame most readers were not watching, and there was
 * no way to put it away. Docked, the player keeps its "always there, never
 * remounted" property while costing a corner instead of a band, and the viewer
 * can dismiss it.
 *
 * ## Why `<aside>` and not a modal dialog
 *
 * A modal would trap focus and block the page, which is the opposite of what a
 * picture-in-picture player is for: you watch it WHILE reading the bracket. So
 * this is a complementary landmark — it announces itself, it is reachable in
 * the landmark list, it takes no focus on arrival, and Escape closes it as a
 * convenience for whoever is already inside it.
 *
 * `z-40` puts it under the real modals (`ui/dialog`, and therefore the
 * bracket's fullscreen view) and under the cookie banner, both `z-50`. A
 * first-time visitor sees the consent banner over the dock, which is the
 * correct precedence.
 *
 * ## Why hiding unmounts the frame
 *
 * "Hide" ends the stream rather than parking it behind `display: none`: the
 * viewer who dismissed a live player wants their bandwidth back, and a live
 * broadcast has no playback position to lose. The restore control keeps the
 * broadcast one click away, so dismissing is never a dead end.
 *
 * ## Why there is no live badge in the header
 *
 * There was one ("Channel is live") and it said nothing the panel did not
 * already: the frame below it is either playing the cast or replaced by a
 * "Watch on …" link, and the collapsed restore button keeps its dot. A pill
 * over a running player is a caption for something the viewer is looking at.
 *
 * Offline or unembeddable broadcasts keep their link: a YouTube or VK link has
 * no live detection at all (`live === null`), and hiding it would lose the only
 * way to reach the broadcast.
 *
 * ## Why a participant never enters the frame
 *
 * `embeddable` is true only for `live`, so between casts the dock falls back to
 * a bare "Watch on …" link and the page has nothing playing — while
 * participants may be on air the whole time. The dock used to fill the frame
 * with the busiest live participant's POV, announced as exactly that.
 *
 * That is gone: this panel is the ORGANIZER's broadcast, on every section of
 * the page, and a one-sided POV in the corner reserved for the cast reads as
 * the cast however it is captioned. Participant streams have their own section
 * (`TournamentStreamPage`), where the viewer picks the POV deliberately and the
 * page around it says whose it is.
 */
export function TournamentBroadcastDock({ streams, className }: Readonly<TournamentBroadcastDockProps>) {
  const t = useTranslations();
  const [isOpen, setIsOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLButtonElement>(null);
  // Both controls unmount the moment they are used, so focus would fall to
  // <body> and a keyboard user would restart their traversal from the top of
  // the document. The ref gates the effect to USER toggles: without it, the
  // dock would steal focus from the page on first render.
  const shouldMoveFocus = useRef(false);

  useEffect(() => {
    if (!shouldMoveFocus.current) {
      return;
    }
    shouldMoveFocus.current = false;
    (isOpen ? closeRef : restoreRef).current?.focus();
  }, [isOpen]);

  const official = streams?.official ?? [];

  if (official.length === 0) {
    return null;
  }

  const toggle = (next: boolean) => {
    shouldMoveFocus.current = true;
    setIsOpen(next);
  };

  // One player, for the first OFFICIAL broadcast that can carry one. An
  // organizer with two simultaneously live official channels is not a case
  // worth a switcher; the rest stay reachable as links below.
  const featured =
    official.find((entry) => embeddableTwitchChannel(entry) !== null) ?? official[0];
  const featuredChannel = embeddableTwitchChannel(featured);
  const featuredStatus = getStreamStatus(featured.live);
  const secondary = official.filter((entry) => entry !== featured);
  const heading = t("stream.broadcast.heading");

  if (!isOpen) {
    return (
      <button
        ref={restoreRef}
        type="button"
        onClick={() => toggle(true)}
        className={cn(
          ANCHOR,
          "inline-flex items-center gap-2 rounded-full border border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-card)]/95 px-3.5 py-2.5 text-[13px] font-semibold text-[color:var(--aqt-fg)] shadow-xl backdrop-blur outline-none transition-colors hover:border-[color:var(--aqt-teal)] hover:text-[color:var(--aqt-teal)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--aqt-teal)]",
          className
        )}
      >
        <Radio className="size-4 text-[color:var(--aqt-teal)]" aria-hidden />
        {t("stream.broadcast.show")}
        {/* Worth a glance without reopening the frame: the cast is on air.
            A plain dot rather than the `.status-pill.live` markup — that rule
            styles a pill, and stripping its box back off with `!important`
            would be three overrides to end up here anyway. Colour is not the
            only cue: the label beside it names the subject. */}
        {featuredStatus === "live" ? (
          <span aria-hidden className="size-[7px] rounded-full bg-[color:var(--aqt-rose)]" />
        ) : null}
      </button>
    );
  }

  return (
    <aside
      aria-label={heading}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          toggle(false);
        }
      }}
      className={cn(
        ANCHOR,
        "w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-[12px] border border-[color:var(--aqt-border)] bg-[color:var(--aqt-card)]/95 shadow-2xl backdrop-blur",
        className
      )}
    >
      {/* Not `.aqt-card-head`: its 14/18 padding and single line eat a panel
          this narrow. Same vocabulary (title font, bottom rule), tighter box.
          The close control is pinned to the corner rather than laid out in the
          row, so it stays where a viewer looks for it and cannot be pushed off
          by a long heading; the row reserves its width with `pe-11` and wraps
          under it if it must. */}
      <div className="relative flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[color:var(--aqt-border)] py-2.5 pe-11 ps-3">
        <h2 className="aqt-card-title min-w-0">
          <span className="aqt-card-title-ic">
            <Radio className="size-4" aria-hidden />
          </span>
          <span className="truncate">{heading}</span>
        </h2>
        <button
          ref={closeRef}
          type="button"
          onClick={() => toggle(false)}
          aria-label={t("stream.broadcast.hide")}
          // 32px square: over the WCAG 2.5.8 24px floor without turning the
          // header into a toolbar.
          className="absolute end-2 top-2 inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] text-[color:var(--aqt-fg-muted)] outline-none transition-colors hover:bg-[color:var(--aqt-overlay-3)] hover:text-[color:var(--aqt-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--aqt-teal)]"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      {featuredChannel ? (
        // Flush to the panel edges: the frame is the content, and a padded
        // video inside a 380px box wastes the only dimension that matters.
        //
        // The ratio has to come from this wrapper, not from `aspect-video` on
        // the iframe: `TwitchEmbed` carries Twitch's documented 400x300 minimum
        // as HTML attributes, and a presentational `height` beats `aspect-ratio`
        // in the cascade — the frame would render 300px tall at every width and
        // eat half a phone screen. Absolute fill overrides it outright.
        <div className="relative aspect-video w-full bg-black">
          <TwitchEmbed
            channel={featuredChannel}
            title={t("stream.broadcast.playerLabel", { channel: featuredChannel })}
            className="absolute inset-0 size-full border-0"
          />
        </div>
      ) : null}

      {/* Rendered only when it has something to say. The stream's own title
          used to sit here and was dropped: the dock is a corner the viewer
          watches, not reads, and a channel's self-written blurb repeated the
          heading, the pill and the frame's own overlay for two more lines of
          panel. What survives is what the frame cannot say by itself — a way
          out to a platform we cannot embed, and the other official channels. */}
      {!featuredChannel || secondary.length > 0 ? (
        <div className="flex flex-col gap-2.5 p-3">
          {featuredChannel ? null : (
            <a
              href={featured.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center gap-2 rounded-[9px] border border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-overlay-3)] px-3 py-2 text-[13px] font-semibold text-inherit no-underline outline-none transition-colors hover:text-[color:var(--aqt-teal)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--aqt-teal)]"
            >
              <SocialIcon provider={featured.platform} size={14} />
              <span>{t("stream.broadcast.watchOn", { platform: streamPlatformLabel(featured) })}</span>
              <ExternalLink className="size-3.5 opacity-70" aria-hidden />
            </a>
          )}
          {secondary.length > 0 ? (
            <ul
              aria-label={t("stream.broadcast.moreLinks")}
              className="m-0 flex list-none flex-wrap gap-2 p-0"
            >
              {secondary.map((entry) => (
                <li key={entry.url}>
                  <a
                    href={entry.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-[7px] border border-[color:var(--aqt-border-2)] px-2 py-1 text-[12.5px] font-medium text-inherit no-underline outline-none transition-colors hover:text-[color:var(--aqt-teal)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--aqt-teal)]"
                  >
                    <SocialIcon provider={entry.platform} size={12} />
                    <span>{entry.channel || streamPlatformLabel(entry)}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}

export default TournamentBroadcastDock;
