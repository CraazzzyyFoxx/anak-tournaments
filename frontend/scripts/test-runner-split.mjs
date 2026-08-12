// The frontend runs its tests on TWO runners, and the split has to be total.
//
// `vitest.config.ts`'s `include` is an allow-list; ~60 other files use
// `bun:test`, which vitest cannot even import. Nothing enforced the pairing, so
// nine files came to import `vitest` while matching no pattern: vitest never
// collected them and the suite still reported green. One threw a TypeError on
// its first line; another asserted a nav list that had gained a section since.
//
// This script makes the split derived rather than maintained:
//
//   vitest runs  = `vitest list` (vitest's own collection — no glob semantics
//                  are re-implemented here, so the two can never disagree)
//   bun runs     = every other src/**/*.test.ts(x)
//
// Because bun gets the exact complement, no test file can be invisible to both.
// What still needs checking is that each file landed in the set whose runner it
// actually speaks, since a mismatch there fails loudly for bun but SILENTLY for
// vitest (an unmatched file is simply not collected).
//
// Usage:
//   node scripts/test-runner-split.mjs           # verify the pairing, print a summary
//   node scripts/test-runner-split.mjs --bun     # print the bun file list, one per line

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const VITEST_IMPORT = /from\s+["']vitest["']/;
const BUN_IMPORT = /from\s+["']bun:test["']/;

// Exports a `mock.module` factory MUST reproduce, keyed by module path. Only
// names that something outside the mocking file imports belong here: those are
// the ones whose absence breaks a file other than the one making the mistake.
const MOCK_REQUIRED_EXPORTS = {
  "@/services/auth.service": ["OAuthLinkAuthRequiredError", "OAuthLinkFailedError"],
};

const normalize = (p) => p.replaceAll("\\", "/");

const all = [];
for await (const entry of glob("src/**/*.test.{ts,tsx}")) all.push(normalize(entry));
all.sort();

// One collected path per line. Anything vitest refuses to collect is absent,
// which is precisely the signal this script is built on. The bin is resolved off
// the package manifest (`./vitest.mjs` is not an exported subpath) and invoked
// through the current node rather than `npx`: no shell, so nothing here depends
// on the platform's script-resolution rules.
const require = createRequire(import.meta.url);
const vitestManifest = require.resolve("vitest/package.json");
const vitestBin = resolve(dirname(vitestManifest), require("vitest/package.json").bin.vitest);

const vitestFiles = new Set(
  execFileSync(process.execPath, [vitestBin, "list", "--filesOnly"], { encoding: "utf8" })
    .split("\n")
    .map((line) => normalize(line.trim()))
    .filter((line) => line.endsWith(".test.ts") || line.endsWith(".test.tsx")),
);

const bunFiles = all.filter((file) => !vitestFiles.has(file));

if (process.argv.includes("--bun")) {
  console.log(bunFiles.join("\n"));
  process.exit(0);
}

const problems = [];

for (const file of all) {
  const source = readFileSync(file, "utf8");
  const importsVitest = VITEST_IMPORT.test(source);
  const importsBun = BUN_IMPORT.test(source);

  if (importsVitest && importsBun) {
    problems.push(`${file}\n    imports BOTH vitest and bun:test — pick one runner.`);
  } else if (importsVitest && !vitestFiles.has(file)) {
    problems.push(
      `${file}\n    imports vitest, but no vitest.config.ts \`include\` pattern matches it,` +
        `\n    so nothing runs it. Add it to that array — file-level if its directory also` +
        `\n    holds bun:test files, which a directory glob would drag into vitest.`,
    );
  } else if (importsBun && vitestFiles.has(file)) {
    problems.push(
      `${file}\n    imports bun:test, but a vitest \`include\` pattern collects it — vitest` +
        `\n    fails on that import. Narrow the pattern to file level.`,
    );
  }
  // A file importing NEITHER is fine: under `bun test` describe/it/expect are
  // globals, and several helper suites rely on that. It lands in the bun set by
  // complement, and bun fails loudly if it is not really a test.

  // `bun test` shares ONE module registry across every file in a run, so the
  // first `mock.module` for a path is what all the others see. A mock that omits
  // an export its real module has takes down every file whose import graph needs
  // that name — with a SyntaxError at import time, so those tests do not run and
  // do not report. This cost two CI cycles before it was pinned here.
  // Checked against the code with whole-line comments stripped: prose ABOVE a
  // mock naturally names the very exports it is explaining, and a whole-file
  // substring search happily accepts that instead of the factory.
  const code = source.replace(/^\s*\/\/.*$/gm, "");
  for (const [path, required] of Object.entries(MOCK_REQUIRED_EXPORTS)) {
    if (!code.includes(`mock.module("${path}"`)) continue;
    const missing = required.filter((name) => !code.includes(name));
    if (missing.length > 0) {
      problems.push(
        `${file}\n    mocks "${path}" without re-exporting ${missing.join(", ")}.` +
          `\n    bun's registry is shared, so this mock silently breaks every other file` +
          `\n    that needs those names. Add them to the mock factory.`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error(`\n${problems.length} test file(s) are paired with the wrong runner:\n`);
  for (const problem of problems) console.error(`  - ${problem}\n`);
  process.exit(1);
}

console.log(
  `${all.length} test files, split cleanly: ${vitestFiles.size} vitest, ${bunFiles.length} bun:test.`,
);
