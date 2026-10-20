"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { LinkTabs, type LinkTabItem } from "@/components/kit/LinkTabs";
import { PageStateCard } from "@/components/ui/page-state-card";
import { GameScopeControl } from "@/components/workspace/GameScopeControl";
import { useGameScope } from "@/hooks/useGameScope";
import { useKindLabel } from "@/hooks/useKindLabel";
import { DISCIPLINE_PARAM } from "@/lib/site/discipline-scope";
import type { CatalogKind } from "@/types/catalog.types";

import { ContentDisciplineProvider } from "./_components/ContentDiscipline";
import { useOpenMissCount } from "./miss-queue";

/** Tab key → the catalog kind it edits. The URL segments predate the multi-game catalog and stay. */
const KIND_TABS = { heroes: "character", maps: "map", gamemodes: "mode" } as const satisfies Record<string, CatalogKind>;
const TABS = [...(Object.keys(KIND_TABS) as (keyof typeof KIND_TABS)[]), "unresolved"] as const;

/**
 * Game content (F13): the catalogues the log parser reads for ONE selected game, plus the triage queue of names it
 * could not resolve (every game).
 *
 * A platform page (spec §3.7): the catalogue is platform-wide, so its game tabs list every installed discipline (axis
 * `all`), not the current community's; there is no scope pill. The game is `?discipline=`, else the first one (the
 * admin never reads the site's saved scope); an invalid `?discipline=` is named, never corrected, and loads nothing. The
 * queue is not a catalogue and ignores the choice, but it is the work the catalogues exist to absorb, so it sits
 * beside them with a badge saying how much of it is waiting.
 *
 * Navigation and chrome only: the tabs own no data beyond that count, and each page keeps its own toolbar.
 */
export default function GameContentLayout({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const t = useTranslations("adminWorkspace.content");
  const labelOf = useKindLabel();
  // `/admin/content/<tab>` — the bare root redirects, so the fallback only
  // covers the frame between navigation and that redirect landing.
  const activeKey = pathname.split("/")[3] ?? TABS[0];
  const openMisses = useOpenMissCount();
  const gameScope = useGameScope({ pageClass: "platform", axis: "all" });
  const { games: disciplines, resolution, isError, refetch } = gameScope;

  const descriptor =
    gameScope.game === null ? undefined : disciplines?.find((discipline) => discipline.code === gameScope.game);
  const carry = descriptor ? `?${DISCIPLINE_PARAM}=${encodeURIComponent(descriptor.code)}` : "";

  // A kind the game does not declare (League has no `mode`) has no tab: nothing to list or create there.
  const shown = TABS.filter((tab) => tab === "unresolved" || !descriptor || KIND_TABS[tab] in descriptor.kinds);
  const items: LinkTabItem[] = shown.map((tab) => ({
    key: tab,
    label: tab === "unresolved" || !descriptor ? t(`tabs.${tab}`) : labelOf(descriptor, KIND_TABS[tab]),
    href: tab === "unresolved" ? `/admin/content/${tab}` : `/admin/content/${tab}${carry}`,
    // An empty queue is not news: no badge rather than a zero.
    badge: tab === "unresolved" ? openMisses || undefined : undefined
  }));

  let body: ReactNode;
  if (activeKey === "unresolved") {
    body = children;
  } else if (isError) {
    body = <PageStateCard state="error" onAction={refetch} />;
  } else if (resolution === null || disciplines === undefined) {
    body = null;
  } else if (resolution.game.kind === "invalid" || resolution.game.kind === "empty") {
    body = <GameScopeControl scope={gameScope} variant="single" />;
  } else if (descriptor) {
    // Keyed by game: another game's open dialog, filters and form drafts never carry over.
    body = (
      <ContentDisciplineProvider key={descriptor.code} descriptor={descriptor}>
        {children}
      </ContentDisciplineProvider>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title={t("header")}
        actions={
          activeKey !== "unresolved" && gameScope.game !== null ? (
            <GameScopeControl scope={gameScope} variant="single" />
          ) : undefined
        }
      />
      <LinkTabs items={items} activeKey={activeKey} level={1} ariaLabel={t("sectionsLabel")} />
      {body}
    </div>
  );
}
