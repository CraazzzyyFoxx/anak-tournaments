import type { DisciplineSlot, DisciplineUI } from "../types";

export type DisciplineLoader<S extends DisciplineSlot> = (code: string) => Promise<DisciplineUI<S> | null>;

/**
 * The loader of one slot family: static lazy imports of the installed local modules that declare slots of
 * that family. An unknown code (or one this family has no module for) resolves to `null`, never to another
 * game's module; the load is memoised per code. Imports no module itself, so only a family registry that
 * names its modules reaches them.
 */
export function createDisciplineLoader<S extends DisciplineSlot>(
  modules: Readonly<Record<string, () => Promise<{ default: DisciplineUI<S> }>>>
): DisciplineLoader<S> {
  const cache = new Map<string, Promise<DisciplineUI<S> | null>>();
  return (code) => {
    const load = Object.hasOwn(modules, code) ? modules[code] : undefined;
    if (!load) return Promise.resolve(null);
    let pending = cache.get(code);
    if (!pending) {
      pending = load().then((mod) => mod.default);
      cache.set(code, pending);
    }
    return pending;
  };
}
