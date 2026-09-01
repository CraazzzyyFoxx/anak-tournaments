import { useCallback, useMemo, useState } from "react";

interface VisibilityColumn {
  id: string;
  defaultVisible: boolean;
}

function loadVisibility(storageKey: string | null): Record<string, boolean> | null {
  if (storageKey === null || typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    return null;
  }
}

function saveVisibility(storageKey: string | null, visibility: Record<string, boolean>) {
  if (storageKey === null || typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(visibility));
  } catch {
    // localStorage full or unavailable — ignore
  }
}

/**
 * Column visibility, persisted per table. A `null` storage key keeps the
 * choice in memory only — for a table that does not offer the picker.
 */
export function useColumnVisibility<T extends VisibilityColumn>(
  storageKey: string | null,
  columns: T[],
) {
  const defaults = useMemo(() => {
    const d: Record<string, boolean> = {};
    for (const col of columns) {
      d[col.id] = col.defaultVisible;
    }
    return d;
  }, [columns]);

  const [visibility, setVisibility] = useState<Record<string, boolean>>(
    () => {
      const stored = loadVisibility(storageKey);
      if (!stored) return defaults;
      // Merge: keep stored values for known columns, use defaults for new ones
      const merged: Record<string, boolean> = { ...defaults };
      for (const key of Object.keys(merged)) {
        if (key in stored) {
          merged[key] = stored[key];
        }
      }
      return merged;
    },
  );

  const toggleColumn = useCallback(
    (id: string) => {
      setVisibility((prev) => {
        const next = { ...prev, [id]: !prev[id] };
        saveVisibility(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  const resetToDefaults = useCallback(() => {
    setVisibility(defaults);
    saveVisibility(storageKey, defaults);
  }, [storageKey, defaults]);

  return { visibility, toggleColumn, resetToDefaults };
}
