import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

/**
 * Z6/Z7 of `scripts/check-zone-boundaries.mjs`, run for real on a tree built here: core reaches a discipline only
 * through its types, host and family registries; only a registry imports a module's family entrypoint; modules stay
 * apart; test code may read a module's helpers.
 */
const SCRIPT = fileURLToPath(new URL("../../scripts/check-zone-boundaries.mjs", import.meta.url));

const TREE: Record<string, string> = {
  "i18n/messages/en.json": "{}",
  "disciplines/types.ts": "export type Slot = string;",
  "disciplines/DisciplineWidget.tsx": "export const DisciplineWidget = 1;",
  "disciplines/registry/create.ts": "export const create = 1;",
  "disciplines/registry/rank.ts":
    'import { create } from "./create";\nexport const loadRankUI = () => import("../overwatch/rank");\nexport { create };',
  "disciplines/registry/deep.ts": 'export { helper } from "../overwatch/ladder/helper";',
  "disciplines/overwatch/rank.ts": 'import { helper } from "./ladder/helper";\nexport default helper;',
  "disciplines/overwatch/ladder/helper.ts": "export const helper = 1;",
  // Relative specs: this file is itself scanned by the real check, where they resolve outside src/.
  "disciplines/overwatch/bad.ts":
    'import { x } from "../lol/x";\nimport "@/app/actions/save";\nimport NotFound from "@/app/not-found";\nimport { Panel } from "../../components/admin/Panel";\nexport { x, NotFound, Panel };',
  "disciplines/lol/x.ts": "export const x = 1;",
  "app/actions/save.ts": "export {};",
  "app/not-found.tsx": "export default function NotFound() { return null; }",
  "components/admin/Panel.tsx": "export const Panel = 1;",
  "lib/ports.ts": [
    'import { loadRankUI } from "@/disciplines/registry/rank";',
    'import type { Slot } from "@/disciplines/types";',
    'import { DisciplineWidget } from "@/disciplines/DisciplineWidget";',
    'import type { helper } from "@/disciplines/overwatch/ladder/helper";',
    "export { loadRankUI, DisciplineWidget };"
  ].join("\n"),
  "lib/core.ts": 'export { helper } from "@/disciplines/overwatch/ladder/helper";',
  "lib/lazy.ts": 'export const load = () => import("@/disciplines/overwatch/rank");',
  "lib/internal.ts": 'const create = require("../disciplines/registry/create");',
  "lib/parity.test.ts": 'import { helper } from "@/disciplines/overwatch/ladder/helper";',
  "lib/flow.behavior.test.tsx": 'import { helper } from "@/disciplines/overwatch/ladder/helper";',
  "test/support.ts": 'export { helper } from "@/disciplines/overwatch/ladder/helper";',
  // Not test files: a behaviour harness, a spec-named module and a test-ish helper are runtime code.
  "lib/session.behavior.ts": 'export { helper } from "@/disciplines/overwatch/ladder/helper";',
  "lib/session.spec.ts": 'export { helper } from "@/disciplines/overwatch/ladder/helper";',
  "lib/foo.test.helpers.ts": 'export { helper } from "@/disciplines/overwatch/ladder/helper";'
};

const root = mkdtempSync(join(tmpdir(), "zones-"));
for (const [path, source] of Object.entries(TREE)) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), source);
}
afterAll(() => rmSync(root, { recursive: true, force: true }));

function disciplineFindings(): string[] {
  const run = spawnSync(process.execPath, [SCRIPT, "--json", `--src=${root}`], { encoding: "utf8" });
  const findings: { rule: string; from: string; to: string }[] = JSON.parse(run.stdout);
  return findings
    .filter((finding) => finding.rule === "Z6" || finding.rule === "Z7")
    .map((finding) => `${finding.rule} ${finding.from} -> ${finding.to}`)
    .sort();
}

describe("discipline import boundaries (Z6/Z7)", () => {
  it("rejects every reach past the ports and passes the legal edges", () => {
    expect(disciplineFindings()).toEqual([
      // core into a module, statically, dynamically, or into the registry's internals
      "Z6 lib/core -> disciplines/overwatch/ladder/helper",
      "Z6 lib/foo.test.helpers -> disciplines/overwatch/ladder/helper",
      "Z6 lib/internal -> disciplines/registry/create",
      "Z6 lib/lazy -> disciplines/overwatch/rank",
      "Z6 lib/session.behavior -> disciplines/overwatch/ladder/helper",
      "Z6 lib/session.spec -> disciplines/overwatch/ladder/helper",
      // a module into another module, anything under src/app (a root entry too) or components/admin; the registry
      // past an entrypoint
      "Z7 disciplines/overwatch/bad -> app/actions/save",
      "Z7 disciplines/overwatch/bad -> app/not-found",
      "Z7 disciplines/overwatch/bad -> components/admin/Panel",
      "Z7 disciplines/overwatch/bad -> disciplines/lol/x",
      "Z7 disciplines/registry/deep -> disciplines/overwatch/ladder/helper"
    ]);
  });
});
