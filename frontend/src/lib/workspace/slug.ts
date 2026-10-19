/**
 * The platform address of a workspace: `<zone>/workspace/<slug>`.
 *
 * One home for the rules both creation entry points (`/get-workspace` and
 * `/admin/workspaces/new`) have to agree on. The backend is the authority
 * (`WorkspaceCreate.slug` pattern, `RESERVED_SLUGS` in
 * `backend/app-service/src/services/workspace/service.py`); this file only
 * answers "is this a legal address" before the request, so a typo is caught at
 * the keystroke rather than at the refusal. "Is it free" is still the create
 * call's answer: there is no availability endpoint.
 */

export const SLUG_MAX_LENGTH = 64;

/** `RESERVED_SUBDOMAINS` plus the platform's own top-level routes. */
const RESERVED_SLUGS: Record<string, true> = {
  www: true,
  api: true,
  auth: true,
  admin: true,
  app: true,
  assets: true,
  static: true,
  cdn: true,
  mail: true,
  ws: true,
  docs: true,
  status: true,
  support: true
};

const SLUG_RE = /^[a-z0-9_-]+$/;
const EDGE_RE = /^[-_]|[-_]$/;

// Cyrillic to ASCII, the transliteration organisers already use for their
// Discord handles and Twitch names (ISO 9-ish, "х" as "h", "ц" as "ts").
const TRANSLIT: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "yo",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
  і: "i",
  ї: "yi",
  є: "ye",
  ґ: "g"
};

/**
 * The address a name suggests: "Весёлый Кубок" -> "vesyolyy-kubok".
 *
 * Cyrillic is transliterated first, on the composed characters (NFD would
 * split "й" into "и" + breve and lose the "y"); then Latin diacritics are
 * stripped, every other run of non-address characters collapses into one
 * hyphen, and the edges are trimmed so the result is never rejected by
 * `validateSlug` for an edge hyphen the typist did not write.
 */
export function suggestSlug(name: string): string {
  const ascii = Array.from(name.toLowerCase())
    .map((char) => TRANSLIT[char] ?? char.normalize("NFD").replace(/\p{M}/gu, ""))
    .join("");
  return ascii
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, SLUG_MAX_LENGTH);
}

export type SlugProblem = "empty" | "format" | "edges" | "reserved" | "length";

/** `null` when the slug is a legal address; otherwise why not, as a code the
 * caller turns into its own sentence. */
export function validateSlug(slug: string): SlugProblem | null {
  if (!slug) return "empty";
  if (slug.length > SLUG_MAX_LENGTH) return "length";
  if (!SLUG_RE.test(slug)) return "format";
  if (EDGE_RE.test(slug)) return "edges";
  if (RESERVED_SLUGS[slug]) return "reserved";
  return null;
}
