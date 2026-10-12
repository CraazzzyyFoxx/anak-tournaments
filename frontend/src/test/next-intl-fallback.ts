import { vi } from "vitest";

import en from "@/i18n/messages/en.json";

// In the app every zone layout mounts `ZoneIntlProvider`, so a component never
// renders without messages. Tests render components bare, and the shared kit
// and data-table pieces are rendered by suites all over the tree. Outside a
// provider, `useTranslations` falls back to the English messages instead of
// throwing; inside one (or under a file's own `vi.mock("next-intl")`) nothing
// changes.
vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>();
  // One translator per namespace: a fresh function every render would change
  // the identity of `t` and re-fire every effect and memo that depends on it.
  const fallbacks = new Map<string, ReturnType<typeof actual.createTranslator>>();
  const fallback = (namespace?: string) => {
    const key = namespace ?? "";
    let translator = fallbacks.get(key);
    if (!translator) {
      translator = actual.createTranslator({ locale: "en", messages: en, namespace: namespace as never });
      fallbacks.set(key, translator);
    }
    return translator;
  };
  return {
    ...actual,
    useTranslations: ((namespace?: string) => {
      try {
        return actual.useTranslations(namespace as never);
      } catch {
        return fallback(namespace);
      }
    }) as typeof actual.useTranslations
  };
});
