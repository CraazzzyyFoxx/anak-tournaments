"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

import FavoriteStarButton from "@/components/FavoriteStarButton";
import { useFavoritePlayers } from "@/hooks/useFavoritePlayers";
import { getPlayerSlug } from "@/utils/player";

export default function FavoritesSection() {
  const t = useTranslations("accountSettings");
  const { favoritePlayers, isLoading } = useFavoritePlayers();

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        {isLoading ? (
          <Loader2
            className="h-4 w-4 animate-spin text-[color:var(--aqt-fg-muted)]"
            aria-label={t("favorites.title")}
          />
        ) : favoritePlayers.length === 0 ? (
          <p className="text-sm text-[color:var(--aqt-fg-dim)]">{t("favorites.empty")}</p>
        ) : (
          <div className="space-y-1.5">
            {favoritePlayers.map((player) => (
              <div
                key={player.id}
                className="flex items-center gap-2 rounded-lg border border-[color:var(--aqt-border)] bg-[color:var(--aqt-overlay-2)] px-3 py-2"
              >
                <Link
                  href={`/users/${getPlayerSlug(player.name)}`}
                  className="flex-1 truncate text-sm text-[color:var(--aqt-fg)] hover:text-[color:var(--aqt-fg-muted)]"
                >
                  {player.name}
                </Link>
                <FavoriteStarButton playerId={player.id} size="sm" />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
