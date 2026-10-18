/** The one or two letters that stand in for a catalog entity's portrait. */
export function catalogInitials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name
    .replace(/[^\p{L}\p{N}]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] ?? name).slice(0, 2).toUpperCase();
}
