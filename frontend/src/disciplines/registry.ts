"use client";

import type { DisciplineUI } from "./types";

/** The only importer of module entrypoints (§7, Z7). Static lazy imports of installed local modules. */
const LOADERS: Record<string, () => Promise<{ default: DisciplineUI }>> = {
  overwatch: () => import("./overwatch"),
  lol: () => import("./lol")
};

const cache = new Map<string, Promise<DisciplineUI | null>>();

/** The installed local module for `code`; unknown code resolves to `null`, never to another game's module. */
export function loadDisciplineUI(code: string): Promise<DisciplineUI | null> {
  const loader = Object.hasOwn(LOADERS, code) ? LOADERS[code] : undefined;
  if (!loader) return Promise.resolve(null);
  let pending = cache.get(code);
  if (!pending) {
    pending = loader().then((mod) => mod.default);
    cache.set(code, pending);
  }
  return pending;
}
