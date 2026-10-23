"use client";

import { MapsBrowser } from "@/components/admin/content/maps/MapsBrowser";

import { CatalogKindGuard } from "../_components/ContentDiscipline";

export default function MapsAdminPage() {
  return <CatalogKindGuard kind="map">{(context) => <MapsBrowser {...context} />}</CatalogKindGuard>;
}
