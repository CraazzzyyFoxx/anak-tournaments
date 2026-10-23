"use client";

import { GamemodesBrowser } from "@/components/admin/content/gamemodes/GamemodesBrowser";

import { CatalogKindGuard } from "../_components/ContentDiscipline";

export default function GamemodesAdminPage() {
  return <CatalogKindGuard kind="mode">{(context) => <GamemodesBrowser {...context} />}</CatalogKindGuard>;
}
