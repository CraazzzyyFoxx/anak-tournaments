import type { Schema } from "@/types/api";

/** Native discipline metadata (P7 contracts §1.4). Aliases of generated wire schemas only. */
export type CatalogKind = "character" | "map" | "mode";
export type DisciplineCapabilities = Schema<"app.DisciplineCapabilities">;
export type DisciplineDescriptor = Schema<"app.DisciplineDescriptor">;
export type OntologyRole = Schema<"app.OntologyRole">;
export type RoleDimension = Schema<"app.RoleDimensionRead">;
export type StatDefinition = Schema<"app.StatDefinition">;
export type EventTypeDefinition = Schema<"app.EventTypeRead">;
export type DisciplineMetadata = Schema<"app.DisciplineMetadata">;
