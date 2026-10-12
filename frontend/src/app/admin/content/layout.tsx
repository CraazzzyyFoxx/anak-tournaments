"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { LinkTabs, type LinkTabItem } from "@/components/kit/LinkTabs";

import { useOpenMissCount } from "./miss-queue";

const TABS = ["heroes", "maps", "gamemodes", "unresolved"] as const;

/**
 * Game content (F13): three catalogues the log parser reads, plus the triage
 * queue of names it could not resolve.
 *
 * The queue is not a fourth catalogue — it shares no code with the other
 * three — but it is the work the catalogues exist to absorb, so it sits beside
 * them with a badge saying how much of it is waiting.
 *
 * Navigation and chrome only: the tabs own no data beyond that count, and each
 * page keeps its own toolbar in the table.
 */
export default function GameContentLayout({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const t = useTranslations("adminWorkspace.content");
  // `/admin/content/<tab>` — the bare root redirects, so the fallback only
  // covers the frame between navigation and that redirect landing.
  const activeKey = pathname.split("/")[3] ?? TABS[0];
  const openMisses = useOpenMissCount();

  const items: LinkTabItem[] = TABS.map((tab) => ({
    key: tab,
    label: t(`tabs.${tab}`),
    href: `/admin/content/${tab}`,
    // An empty queue is not news: no badge rather than a zero.
    badge: tab === "unresolved" ? openMisses || undefined : undefined
  }));

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title={t("header")}
        description={t("description")}
      />
      <LinkTabs items={items} activeKey={activeKey} level={1} ariaLabel={t("sectionsLabel")} />
      {children}
    </div>
  );
}
