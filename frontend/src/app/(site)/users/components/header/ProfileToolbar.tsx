"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { GitCompare } from "lucide-react";

import SharePlayerCard, { type ShareCardData } from "@/app/(site)/users/components/header/SharePlayerCard";
import FavoriteStarButton from "@/components/FavoriteStarButton";

interface ProfileToolbarProps {
  /** Player data used to render the shareable card. */
  card: ShareCardData;
  /** Id of the player this toolbar belongs to, for the favorite star. */
  playerId: number;
  /** Destination for the Compare action. Defaults to the players compare page. */
  comparePath?: string;
}

const BTN =
  "inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--aqt-border)] bg-[hsl(0_0%_100%/0.03)] px-2.5 py-1.5 text-[12.5px] font-semibold text-[color:var(--aqt-fg-muted)] transition-colors hover:text-[color:var(--aqt-fg)]";

/**
 * Header toolbar for the player profile. Share opens the player-card dialog
 * (copy image / download PNG / copy link — design-book §6/§9); Compare links to
 * the existing players-compare page; the star toggles this player in the
 * visitor's favorites (account-scoped, `FavoriteStarButton`/`useFavoritePlayers`).
 */
const ProfileToolbar = ({ card, playerId, comparePath = "/users/compare" }: ProfileToolbarProps) => {
  const t = useTranslations();

  return (
    <div className="flex items-center gap-2">
      <SharePlayerCard card={card} />
      <Link href={comparePath} className={BTN} aria-label={t("users.profile.toolbar.comparePlayers")}>
        <GitCompare size={13} aria-hidden />
        {t("users.profile.toolbar.compare")}
      </Link>
      <FavoriteStarButton playerId={playerId} size="sm" />
    </div>
  );
};

export default ProfileToolbar;
