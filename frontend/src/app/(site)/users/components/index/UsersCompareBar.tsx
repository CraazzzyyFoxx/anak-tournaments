"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";

import { HoverPrefetchLink } from "@/components/HoverPrefetchLink";
import { PlayerAvatar, type PlayerIdentity } from "@/components/PlayerAvatar";
import { Eyebrow } from "@/components/ui/eyebrow";
import { OverlayBar } from "@/components/ui/overlay-bar";

/** The compare tool takes exactly two players. */
const MAX_COMPARE = 2;

export interface CompareSelection {
  selected: PlayerIdentity[];
  isSelected: (id: number) => boolean;
  /** True once the picker is full — further rows render disabled, not inert-looking. */
  isFull: boolean;
  toggle: (user: PlayerIdentity) => void;
  clear: () => void;
}

/**
 * Compare picks are local state, not URL state: they are a transient staging
 * area for one navigation, and the compare page owns the shareable address.
 */
export function useCompareSelection(): CompareSelection {
  const [selected, setSelected] = useState<PlayerIdentity[]>([]);

  const toggle = useCallback((user: PlayerIdentity) => {
    setSelected((previous) => {
      if (previous.some((entry) => entry.id === user.id)) {
        return previous.filter((entry) => entry.id !== user.id);
      }
      if (previous.length >= MAX_COMPARE) return previous;
      return [...previous, user];
    });
  }, []);

  const clear = useCallback(() => setSelected([]), []);

  return {
    selected,
    isSelected: (id) => selected.some((entry) => entry.id === id),
    isFull: selected.length >= MAX_COMPARE,
    toggle,
    clear
  };
}

/** Bottom overlay listing the picks, with the link to the compare page. */
export function UsersCompareBar({ compare }: Readonly<{ compare: CompareSelection }>) {
  const t = useTranslations();
  if (compare.selected.length === 0) return null;

  const [first, second] = compare.selected;
  const ready = compare.selected.length === MAX_COMPARE;

  return (
    <OverlayBar tone={ready ? "active" : "neutral"} ariaLabel={t("users.list.compare.barLabel")}>
      <div className="flex flex-wrap items-center gap-2">
        <Eyebrow>{t("users.list.compare.title")}</Eyebrow>
        {compare.selected.map((user) => (
          <span
            key={user.id}
            className="inline-flex items-center gap-2 rounded-lg border border-[color:var(--aqt-border)] bg-[color:var(--aqt-overlay-2)] py-1 pl-1 pr-2 text-caption"
          >
            <PlayerAvatar user={user} size={22} />
            <span className="max-w-[12rem] truncate">{user.name}</span>
            <button
              type="button"
              onClick={() => compare.toggle(user)}
              aria-label={t("users.list.compare.remove", { name: user.name })}
              className="rounded text-[color:var(--aqt-fg-faint)] outline-none transition-colors hover:text-[color:var(--aqt-fg)] focus-visible:ring-2 focus-visible:ring-[color:var(--aqt-teal)]"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </span>
        ))}

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={compare.clear}
            className="h-8 rounded-lg border border-[color:var(--aqt-border)] px-3 text-caption text-[color:var(--aqt-fg-muted)] outline-none transition-colors hover:text-[color:var(--aqt-fg)] focus-visible:ring-2 focus-visible:ring-[color:var(--aqt-teal)]"
          >
            {t("users.list.compare.clear")}
          </button>
          {ready ? (
            <HoverPrefetchLink
              href={`/users/compare?user_id=${first.id}&target_user_id=${second.id}`}
              className="inline-flex h-8 items-center rounded-lg bg-[color:var(--aqt-teal)] px-4 text-caption font-semibold text-[color:var(--aqt-bg)] outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[color:var(--aqt-teal)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--aqt-card)]"
            >
              {t("users.list.compare.open")}
            </HoverPrefetchLink>
          ) : (
            <span className="text-caption text-[color:var(--aqt-fg-faint)]">
              {t("users.list.compare.needTwo")}
            </span>
          )}
        </div>
      </div>
    </OverlayBar>
  );
}
