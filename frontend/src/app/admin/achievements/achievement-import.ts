/** Why a picked JSON file cannot be imported, before any request is made. */
export type PortableFileProblem =
  | { kind: "shape" }
  | { kind: "version"; version: unknown }
  | { kind: "hero_id"; slug: string };

/**
 * Whether a parsed file is the portable v2 envelope (`discipline` + `entity_id`).
 * v1 files and the retired `hero_id` are named rather than converted: the
 * server refuses them too, this only says so without a round-trip. Everything
 * else — a missing or foreign entity, a disabled game — is the server's call.
 */
export function portableFileProblem(parsed: unknown): PortableFileProblem | null {
  if (parsed === null || typeof parsed !== "object" || !("rules" in parsed) || !Array.isArray(parsed.rules)) {
    return { kind: "shape" };
  }
  const version = "schema_version" in parsed ? parsed.schema_version : undefined;
  if (version !== 2) return { kind: "version", version };
  for (const rule of parsed.rules) {
    if (rule !== null && typeof rule === "object" && "hero_id" in rule) {
      return { kind: "hero_id", slug: "slug" in rule ? String(rule.slug) : "" };
    }
  }
  return null;
}
