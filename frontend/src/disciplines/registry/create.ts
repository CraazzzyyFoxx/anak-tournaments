import type { DisciplineSlot, DisciplineUI } from "../types";

export interface DisciplineLoader<S extends DisciplineSlot> {
  (code: string): Promise<DisciplineUI<S> | null>;
  /** What `code` already resolved to (`null`: no module), or `undefined` while its load has not settled. */
  peek(code: string): DisciplineUI<S> | null | undefined;
}

/**
 * The loader of one slot family: static lazy imports of the installed local modules that declare slots of
 * that family. An unknown code (or one this family has no module for) resolves to `null`, never to another
 * game's module; a module that exists but fails to load rejects — it is not "no module". The load is memoised
 * per code, a failed one is dropped so the next call retries the chunk. Imports no module itself, so only a
 * family registry that names its modules reaches them.
 */
export function createDisciplineLoader<S extends DisciplineSlot>(
  modules: Readonly<Record<string, () => Promise<{ default: DisciplineUI<S> }>>>
): DisciplineLoader<S> {
  const cache = new Map<string, Promise<DisciplineUI<S> | null>>();
  const settled = new Map<string, DisciplineUI<S>>();
  const loader = (code: string) => {
    const load = Object.hasOwn(modules, code) ? modules[code] : undefined;
    if (!load) return Promise.resolve(null);
    let pending = cache.get(code);
    if (!pending) {
      pending = load().then((mod) => {
        settled.set(code, mod.default);
        return mod.default;
      });
      cache.set(code, pending);
      void pending.catch(() => cache.delete(code));
    }
    return pending;
  };
  return Object.assign(loader, {
    peek: (code: string) => (Object.hasOwn(modules, code) ? settled.get(code) : null)
  });
}
