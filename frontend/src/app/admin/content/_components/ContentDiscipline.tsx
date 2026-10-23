"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useTranslations } from "next-intl";

import { PageStateCard } from "@/components/ui/page-state-card";
import { useKindLabel } from "@/hooks/useKindLabel";
import type { CatalogKind } from "@/types/catalog.types";
import type { DisciplineDescriptor } from "@/types/discipline.types";

/** The game whose content the admin sections edit: resolved once by the section layout (§2.3 concrete browsing). */
const ContentDisciplineContext = createContext<DisciplineDescriptor | null>(null);

export function ContentDisciplineProvider({
  descriptor,
  children
}: Readonly<{ descriptor: DisciplineDescriptor; children: ReactNode }>) {
  return <ContentDisciplineContext value={descriptor}>{children}</ContentDisciplineContext>;
}

function useContentDiscipline(): DisciplineDescriptor {
  const descriptor = useContext(ContentDisciplineContext);
  if (descriptor === null) throw new Error("useContentDiscipline needs the content section layout");
  return descriptor;
}

export interface CatalogKindContext {
  descriptor: DisciplineDescriptor;
  discipline: string;
  kind: CatalogKind;
  /** The game's own name for the kind ("Hero", "Champion", "Map", "Mode"). */
  kindLabel: string;
}

/**
 * Renders `children` only for a kind the selected game declares. A kind absent from `descriptor.kinds` (League has
 * no `mode`) is not an empty catalog: nothing is requested and the page says it does not exist for this game.
 */
export function CatalogKindGuard({
  kind,
  children
}: Readonly<{ kind: CatalogKind; children: (context: CatalogKindContext) => ReactNode }>) {
  const descriptor = useContentDiscipline();
  const t = useTranslations("adminWorkspace.content.catalog");
  const labelOf = useKindLabel();

  if (!(kind in descriptor.kinds)) {
    return (
      <PageStateCard
        state="empty"
        title={t("unavailableTitle", { kind: t(`kinds.${kind}`), game: descriptor.name })}
        description={t("unavailable", { game: descriptor.name })}
      />
    );
  }
  return <>{children({ descriptor, discipline: descriptor.code, kind, kindLabel: labelOf(descriptor, kind) })}</>;
}
