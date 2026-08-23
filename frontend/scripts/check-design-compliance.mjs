#!/usr/bin/env node
// Design-system compliance gate for frontend/src.
//
// Enforces the rules in frontend/DESIGN.md that a type checker cannot see.
// Unlike an ESLint ruleset this also covers *.css, where most colour escapes
// live. Exemptions are declared here, once, instead of being re-litigated at
// each call site.
//
// Usage: node scripts/check-design-compliance.mjs [--json]

import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

const ROOT = new URL("../src/", import.meta.url);

/** Paths that are legitimately outside the token system, with the reason. */
const EXEMPT_FILES = [
  // Satori renders OG images in a separate pass that cannot resolve CSS custom properties.
  [/opengraph-image\.tsx$/, "satori cannot resolve css variables"],
  // Mermaid's theme is a JS object; it reads no stylesheets.
  [/MermaidDiagram\.tsx$/, "mermaid themeVariables is a js api"],
  // Test fixtures carry BattleTags and sample payloads, not chrome.
  [/\.(test|spec)\.[jt]sx?$/, "test fixture"],
];

const RULES = [
  {
    id: "R1-neutrals",
    what: "banned neutral Tailwind families (theming cannot reach them)",
    files: "**/*.{ts,tsx}",
    // Colour utilities only: `border-slate-300`, `bg-zinc-950`, `text-gray-400`.
    re: /\b(?:bg|text|border|from|to|via|fill|stroke|ring|divide|outline|shadow|accent|caret|placeholder|decoration)-(?:slate|zinc|gray|neutral|stone)-\d{2,3}\b/g,
  },
  {
    id: "R1-hex",
    what: "raw hex in CSS (must be a token so workspace theming can reach it)",
    files: "**/*.css",
    // A colour hex sits at a value boundary. `Anak#2100` (a BattleTag) does not.
    re: /(?:^|[\s(,:;])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g,
    // The `--aqt-brand-*` block is the one sanctioned home for raw hex: a
    // third-party brand hue has no themeable equivalent, and the `-fg` variants
    // are contrast-tuned by hand (WCAG AA as small label text), not derivable.
    allow: /--aqt-brand-[a-z]+(?:-fg)?\s*:/,
  },
  {
    id: "R2-color-hint",
    what: "arbitrary colour value without the `color:` hint (ambiguous with font-size in Tailwind v4)",
    files: "**/*.{ts,tsx}",
    re: /\b(?:text|border|bg|fill|stroke|ring|divide|outline|decoration|from|to|via)-\[var\(--/g,
  },
  {
    id: "R3-shadcn-shadow",
    what: "shadcn token redefined to a complete colour -> hsl(hsl()) -> transparent subtree",
    files: "**/*.css",
    re: /^\s*--(background|foreground|card|card-foreground|border|primary|secondary|muted|accent|popover|input|ring|destructive)(-foreground)?\s*:\s*([^;]+)/gm,
    // Tailwind wraps these names as hsl(var(--name)), so the value must stay a
    // bare HSL triplet. A triplet, or an alias to another such token, is fine;
    // a complete colour makes the whole subtree render transparent.
    ok: (value) =>
      /^\d[\d.]*\s+[\d.]+%\s+[\d.]+%(\s*\/\s*[\d.]+%?)?$/.test(value.trim()) ||
      /^var\(--(background|foreground|card|border|primary|secondary|muted|accent|popover|input|ring|destructive)/.test(value.trim()),
  },
  {
    id: "R4-locale",
    what: "pinned locale (default locale is ru; format through next-intl)",
    files: "**/*.{ts,tsx}",
    re: /(?:toLocale(?:Date|Time)?String|Intl\.(?:Number|DateTime|RelativeTime|List|PluralRules)Format)\(\s*["'][a-zA-Z-]+["']/g,
    // Scoped exemptions, not blanket file exemptions: this rule only.
    exempt: [
      // Reads `formatToParts` and parses the parts back to numbers. ASCII digits
      // are a correctness requirement there and nothing reaches the UI, so a
      // pinned locale is the fix rather than the bug. See the comment in-file.
      [/lib[\\/]timezone\.ts$/, "machine-readable parts, never rendered"],
    ],
  },
  {
    id: "R5-glyph-icon",
    what: "bare glyph as an icon (screen readers read it literally; use lucide-react)",
    files: "**/*.{ts,tsx}",
    // A glyph is an icon only when it is an element's entire content (`>×<`) or
    // a string holding nothing else (`"→"`). A glyph padded with spaces inside a
    // string is a prose separator or joiner (`.join(" → ")`) and is legitimate.
    re: /(?:>\s*[\u2190\u2192\u2191\u2193\u2713\u2714\u00d7\u2715\u2605\u25b2\u25bc]\s*<|["'`][\u2190\u2192\u2191\u2193\u2713\u2714\u00d7\u2715\u2605\u25b2\u25bc]["'`])/g,
    // The system sanctions two typographic marks — the `→` in "View all →" and
    // the `‹ ›` chevrons — on the condition that they sit next to real text and
    // are hidden from assistive tech. Honour that condition rather than banning
    // the character outright.
    allow: /aria-hidden/,
  },
  {
    id: "R6-floor",
    what: "type below the 11px readability floor",
    files: "**/*.{ts,tsx,css}",
    // Three carriers, each with its own unit rules:
    //   text-[9px]              Tailwind arbitrary utility, px required
    //   font-size: 9px          CSS declaration, px required
    //   fontSize: 9 | "9px"     style object, unitless means px in React
    // `rem`/`em` are deliberately NOT matched. `em` is relative to an ancestor
    // and `rem` to a root font-size that a theme may change, so neither can be
    // resolved by reading one line. The browser sweep covers those: it reads
    // computed px, which is the only place the question has a real answer.
    re: /(?:text-\[|font-size:\s*)(?<![\d.])(?:[0-9]|10)(?:\.[0-9]+)?px|fontSize:\s*(?:(?<![\d.])(?:[0-9]|10)(?:\.[0-9]+)?\s*[,}]|["'](?<![\d.])(?:[0-9]|10)(?:\.[0-9]+)?px["'])/g,
    // A decorative mono coordinate carries no information and may stay small,
    // but it has to say so on the same line.
    allow: /decorative/i,
  },
  {
    id: "R7-resize-hover",
    what: "hover that changes size (must be colour/background only)",
    files: "**/*.{ts,tsx}",
    re: /\b(?:group-)?hover:(?:scale-|text-(?:base|lg|xl|2xl))/g,
  },
  {
    id: "R7-fake-button",
    what: "role=button on a non-button, or onClick on a div/span",
    files: "**/*.{ts,tsx}",
    // `[role='button']` inside a selector string *detects* real buttons — that
    // is the correct pattern, not the anti-pattern, so require a JSX attribute
    // position by rejecting a preceding `[`.
    re: /(?<!\[)role=["']button["']|<(?:div|span)\b[^>]*\sonClick=/g,
  },
];

/** Global exemptions, plus the rule's own scoped ones. */
function exemptReason(path, rule) {
  for (const [re, why] of [...EXEMPT_FILES, ...(rule?.exempt ?? [])])
    if (re.test(path)) return why;
  return null;
}

/**
 * Blank out comment bodies while preserving offsets, so a violation inside a
 * comment never reports and every line number stays true. A per-line prefix
 * test cannot do this: a `/* … *\/` block's continuation lines carry no marker.
 */
function stripComments(source) {
  // `//` only starts a comment when nothing runs into it. Requiring a
  // non-`:`/word/slash predecessor keeps `https://…` and CSS `url(//…)` intact,
  // and CSS has no line comments to lose.
  return source.replace(/\/\*[\s\S]*?\*\/|(?<![:\w/])\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
}

const findings = [];
for (const rule of RULES) {
  for (const rel of globSync(rule.files, { cwd: ROOT })) {
    const path = `src/${rel.replace(/\\/g, "/")}`;
    if (exemptReason(path, rule)) continue;
    const lines = stripComments(readFileSync(new URL(rel, ROOT), "utf8")).split(/\r?\n/);
    lines.forEach((line, i) => {
      if (rule.allow?.test(line)) return;
      rule.re.lastIndex = 0;
      for (const m of line.matchAll(rule.re)) {
        // A rule with `ok` inspects the matched value and passes when it is legal.
        if (rule.ok?.(m[m.length - 1])) continue;
        findings.push({ rule: rule.id, what: rule.what, path, line: i + 1, match: m[0].trim() });
      }
    });
  }
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(findings, null, 2));
} else {
  const byRule = new Map();
  for (const f of findings) byRule.set(f.rule, [...(byRule.get(f.rule) ?? []), f]);
  for (const rule of RULES) {
    const hits = byRule.get(rule.id) ?? [];
    console.log(`${hits.length === 0 ? "PASS" : "FAIL"}  ${rule.id.padEnd(18)} ${String(hits.length).padStart(4)}  ${rule.what}`);
    for (const f of hits.slice(0, 12)) console.log(`        ${f.path}:${f.line}  ${f.match}`);
    if (hits.length > 12) console.log(`        … ${hits.length - 12} more`);
  }
  console.log(`\n${findings.length} finding(s)`);
}

process.exit(findings.length === 0 ? 0 : 1);
