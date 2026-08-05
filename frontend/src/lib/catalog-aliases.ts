/**
 * The alias textarea's wire format: one alias per line.
 *
 * Mirrors `normalize_aliases` in `backend/shared/catalog_aliases.py` — trim,
 * drop blanks, dedupe preserving input order — so what the dialog sends back is
 * exactly what the server would have stored anyway, and a round trip through
 * the textarea never reorders or duplicates an existing list.
 */
export function parseAliasesInput(value: string): string[] {
  const seen = new Set<string>();
  const aliases: string[] = [];

  for (const line of value.split("\n")) {
    const alias = line.trim();
    if (!alias || seen.has(alias)) {
      continue;
    }
    seen.add(alias);
    aliases.push(alias);
  }

  return aliases;
}

/** Renders a stored alias list back into the textarea's value. */
export function formatAliasesInput(aliases: string[]): string {
  return aliases.join("\n");
}
