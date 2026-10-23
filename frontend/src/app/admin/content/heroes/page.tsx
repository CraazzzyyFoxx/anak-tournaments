"use client";

import { HeroesBrowser } from "@/components/admin/content/heroes/HeroesBrowser";

import { CatalogKindGuard } from "../_components/ContentDiscipline";

export default function CharactersAdminPage() {
  return <CatalogKindGuard kind="character">{(context) => <HeroesBrowser {...context} />}</CatalogKindGuard>;
}
