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

const scopeGame = vi.hoisted(() => ({ value: null as string | null }));

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
  const { gameScopeState } = await import("@/test/game-scope");
  return { useGameScope: () => gameScopeState(scopeGame.value) };
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
vi.mock("./_components/AchievementFormDialog", () => ({ AchievementFormDialog: () => null }));
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
});
