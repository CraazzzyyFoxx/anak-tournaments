// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { navigation } from "@/test/url-navigation";

import AchievementsPage from "./page";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** The page's game (`value`, `null`: all games) and the saved scope's (`saved`; `undefined`: the page's own). */
const scopeGame = vi.hoisted(() => ({ value: null as string | null, saved: undefined as string | undefined }));

vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>();
  const { default: en } = await import("@/i18n/messages/en.json");
  return {
    ...actual,
    useTranslations: (namespace?: string) =>
      actual.createTranslator({ locale: "en", messages: en, namespace: namespace as never })
  };
});
vi.mock("next/navigation", async () => (await import("@/test/url-navigation")).nextNavigationMock);
vi.mock("@/hooks/useGameScope", async () => {
  const { gameScopeState, multiResolution } = await import("@/test/game-scope");
  return {
    useGameScope: () => {
      const { value, saved } = scopeGame;
      if (saved === undefined) return gameScopeState(value);
      // An explicit `?discipline=` narrows the list past the saved scope.
      return gameScopeState(value, { resolution: { ...multiResolution(value), scope: saved } });
    }
  };
});
vi.mock("@/hooks/useGameDescriptors", async () => {
  const { GAME_DESCRIPTORS } = await import("@/test/game-scope");
  return { useGameDescriptors: () => GAME_DESCRIPTORS };
});
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ canAccessPermission: () => true }) }));
vi.mock("@/services/admin.service", () => ({ default: {} }));
vi.mock("./_hooks/useAchievementCatalog", () => ({
  useAchievementCatalog: () => ({ tournaments: { results: [] }, overrides: [], allRules: [] })
}));
vi.mock("@/components/admin/AdminPageHeader", () => ({
  AdminPageHeader: ({ actions }: { actions?: ReactNode }) => <div>{actions}</div>
}));
vi.mock("@/components/kit/ConfirmDialog", () => ({ ConfirmDialog: () => null }));
vi.mock("@/components/admin/achievements/EvaluationRunSummary", () => ({ EvaluationRunSummary: () => null }));
// `data-form-game` is the game the open create/edit form files the rule under.
vi.mock("./_components/AchievementFormDialog", () => ({
  AchievementFormDialog: ({ form }: { form: { open: boolean; discipline: string | null } }) =>
    form.open ? <output data-form-game={form.discipline ?? ""} /> : null
}));
vi.mock("./_components/AchievementImportDialog", () => ({ AchievementImportDialog: () => null }));
vi.mock("./_components/AchievementOverridesCard", () => ({ AchievementOverridesCard: () => null }));
vi.mock("./_components/DryRunResultPanel", () => ({ DryRunResultPanel: () => null }));
vi.mock("./_components/EvaluateAchievementsDialog", () => ({ EvaluateAchievementsDialog: () => null }));
vi.mock("./_components/AchievementsTable", () => ({ AchievementsTable: () => <div data-table /> }));

let root: Root;
let container: HTMLElement;

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <AchievementsPage />
        </TooltipProvider>
      </QueryClientProvider>
    );
  });
}

async function openMenu() {
  const trigger = container.querySelector('button[aria-label="More actions"]');
  expect(trigger).toBeTruthy();
  await act(async () => {
    trigger!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
  });
}

const item = (label: string) =>
  Array.from(document.querySelectorAll('[role="menuitem"]')).find((node) => node.textContent?.startsWith(label));
const PER_GAME = ["Evaluate achievements", "Export JSON", "Seed defaults", "Hard reset"];

beforeEach(() => {
  scopeGame.value = null;
  scopeGame.saved = undefined;
  navigation.reset("/admin/achievements");
  document.body.innerHTML = "";
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  useWorkspaceStore.setState({ currentWorkspaceId: 7, lastGame: null });
});

afterEach(async () => {
  await act(async () => root.unmount());
});

describe("/admin/achievements under the game scope", () => {
  it("disables the per-game bulk actions under all games and keeps import", async () => {
    await mount();
    await openMenu();

    for (const label of PER_GAME) expect(item(label)?.hasAttribute("data-disabled"), label).toBe(true);
    expect(item("Import…")?.hasAttribute("data-disabled")).toBe(false);
  });

  it("acts on the game in scope", async () => {
    scopeGame.value = "lol";
    await mount();
    await openMenu();

    for (const label of PER_GAME) expect(item(label)?.hasAttribute("data-disabled"), label).toBe(false);
  });

  it("starts a new rule in the saved scope's game, not in a URL game that only narrows the list", async () => {
    scopeGame.value = "lol";
    scopeGame.saved = "overwatch";
    await mount();

    const create = [...container.querySelectorAll("button")].find((node) => node.textContent === "Create achievement");
    await act(async () => create?.click());

    expect(container.querySelector("[data-form-game]")?.getAttribute("data-form-game")).toBe("overwatch");
  });
});
