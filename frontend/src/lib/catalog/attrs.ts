type WithAttrs = { attrs: Record<string, unknown> };

/** The module-declared class of a character (`attrs.class`): display and filter metadata, never a player's role. */
export function characterClass(entity: WithAttrs | null | undefined): string | undefined {
  const value = entity?.attrs.class;
  return typeof value === "string" ? value : undefined;
}
