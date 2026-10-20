// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { navigation } from "@/test/url-navigation";
import type { AchievementRule } from "@/types/admin.types";

import { AchievementsTable } from "./AchievementsTable";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getAchievementRules = vi.fn();

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
vi.mock("@/services/admin.service", () => ({
  default: { getAchievementRules: (...args: unknown[]) => getAchievementRules(...args) }
}));
vi.mock("@/hooks/useGameDescriptors", async () => {
  const { GAME_DESCRIPTORS } = await import("@/test/game-scope");
  return { useGameDescriptors: () => GAME_DESCRIPTORS };
});

function rule(id: number, discipline: string, name: string): AchievementRule {
  return {
    id,
    workspace_id: 7,
    slug: `rule-${id}`,
    name,
    description_ru: "ru",
    description_en: "en",
    image_url: null,
    discipline,
    entity_id: null,
    category: "overall",
    scope: "global",
    grain: "user",
    condition_tree: {},
    depends_on: [],
    enabled: true,
    rule_version: 1,
    min_tournament_id: null,
    created_at: "2026-10-18T00:00:00Z",
    updated_at: null
  };
}

const ACTIONS = {
  canUpdate: true,
  canDelete: true,
  onOpen: vi.fn(),
  onEdit: vi.fn(),
  onTest: vi.fn(),
  onEvaluate: vi.fn(),
  onToggle: vi.fn(),
  onDelete: vi.fn()
};

let root: Root;
let container: HTMLElement;

async function mount(discipline: string | null, showGame: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <AchievementsTable workspaceId={7} discipline={discipline} showGame={showGame} actions={ACTIONS} />
        </TooltipProvider>
      </QueryClientProvider>
    );
  });
  for (let turn = 0; turn < 5; turn += 1) {
    await act(() => new Promise<void>((done) => setTimeout(done, 0)));
  }
}

const headers = () => Array.from(container.querySelectorAll("th")).map((cell) => cell.textContent?.trim());

beforeEach(() => {
  navigation.reset("/admin/achievements");
  getAchievementRules.mockReset().mockResolvedValue({
    results: [rule(1, "overwatch", "Clutch"), rule(2, "lol", "Pentakill")],
    total: 2,
    page: 1,
    per_page: 15
  });
  document.body.innerHTML = "";
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
});

describe("the rule catalog under the game scope", () => {
  it("lists every game's rules with a Game column when no game is chosen", async () => {
    await mount(null, true);

    expect(getAchievementRules).toHaveBeenCalledWith(7, null, expect.any(Object));
    expect(headers()).toContain("Game");
    const rows = Array.from(container.querySelectorAll("tbody tr")).map((row) => row.textContent ?? "");
    expect(rows.find((text) => text.includes("Pentakill"))).toContain("League of Legends");
  });

  it("lists one game's rules without the column", async () => {
    await mount("lol", false);

    expect(getAchievementRules).toHaveBeenCalledWith(7, "lol", expect.any(Object));
    expect(headers()).not.toContain("Game");
  });
});
