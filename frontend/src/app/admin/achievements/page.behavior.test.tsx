// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { navigation } from "@/test/url-navigation";

import { useWorkspaceStore } from "@/stores/workspace.store";
import type { Workspace } from "@/types/workspace.types";

import AchievementsPage from "./page";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  createAchievementOverride: vi.fn(),
  seedAchievementRules: vi.fn(),
  rulesOf: { overwatch: [{ id: 11 }], lol: [{ id: 21 }] } as Record<string, { id: number }[]>,
  disciplines: [] as { code: string; name: string; enabled: boolean }[],
}));

vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>();
  const { default: en } = await import("@/i18n/messages/en.json");
  return {
    ...actual,
    useTranslations: (namespace?: string) =>
      actual.createTranslator({ locale: "en", messages: en, namespace: namespace as never }),
  };
});
vi.mock("next/navigation", async () => (await import("@/test/url-navigation")).nextNavigationMock);
vi.mock("@/services/discipline.service", () => ({ default: { list: async () => mocks.disciplines } }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ canAccessPermission: () => true }) }));
vi.mock("@/services/admin.service", () => ({
  default: {
    createAchievementOverride: mocks.createAchievementOverride,
    seedAchievementRules: mocks.seedAchievementRules,
  },
}));
vi.mock("./_hooks/useAchievementCatalog", () => ({
  // The catalogue of the game the page asks for, as the real hook would return it.
  useAchievementCatalog: ({ discipline }: { discipline: string | null }) => ({
    tournaments: { results: [] },
    overrides: [],
    refetchOverrides: () => {},
    allRules: mocks.rulesOf[discipline ?? ""] ?? [],
  }),
}));
vi.mock("@/components/admin/AdminPageHeader", () => ({
  AdminPageHeader: ({ actions }: { actions?: React.ReactNode }) => <div>{actions}</div>,
}));
vi.mock("@/components/kit/EmptyNote", () => ({ EmptyNote: ({ children }: { children: React.ReactNode }) => <p>{children}</p> }));
vi.mock("@/components/kit/ConfirmDialog", () => ({ ConfirmDialog: () => null }));
vi.mock("@/components/admin/achievements/EvaluationRunSummary", () => ({ EvaluationRunSummary: () => null }));
vi.mock("./_components/AchievementFormDialog", () => ({ AchievementFormDialog: () => null }));
vi.mock("./_components/AchievementLibraryDialog", () => ({ AchievementLibraryDialog: () => null }));
vi.mock("./_components/AchievementOverridesCard", () => ({ AchievementOverridesCard: () => null }));
vi.mock("./_components/AchievementsTable", () => ({ AchievementsTable: () => null }));
vi.mock("./_components/DryRunResultDialog", () => ({ DryRunResultDialog: () => null }));
vi.mock("./_components/EvaluateAchievementsDialog", () => ({ EvaluateAchievementsDialog: () => null }));
vi.mock("./_components/ImportOutcomePanels", () => ({ ImportErrorPanel: () => null, ImportResultPanel: () => null }));
vi.mock("@/components/workspace/DisciplineSelector", () => ({
  DisciplineSelector: ({
    disciplines,
    onSelect,
  }: {
    disciplines: { code: string }[];
    onSelect: (game: string) => void;
  }) => (
    <div>
      {disciplines.map((game) => (
        <button key={game.code} data-pick={game.code} onClick={() => onSelect(game.code)} />
      ))}
    </div>
  ),
  DisciplineUnavailable: ({ resolved }: { resolved: { kind: string } }) => <p data-unavailable={resolved.kind} />,
}));
// The dialog is replaced by a probe that can fill the draft with any rule id, as a stale draft would hold.
vi.mock("./_components/AchievementOverrideDialog", () => ({
  AchievementOverrideDialog: ({
    open,
    draft,
    onDraftChange,
    onSubmit,
    formError,
  }: {
    open: boolean;
    draft: { ruleId?: number; userId?: number; reason: string };
    onDraftChange: (next: never) => void;
    onSubmit: () => void;
    formError: string | null;
  }) => (
    <div data-override-open={String(open)} data-draft-rule={String(draft.ruleId ?? "")}>
      <button data-fill="11" onClick={() => onDraftChange({ ...draft, userId: 1, ruleId: 11, reason: "why" } as never)} />
      <button data-submit onClick={onSubmit} />
      {formError && <p role="alert">{formError}</p>}
    </div>
  ),
}));

function workspace(id: number, disciplines: string[]): Workspace {
  return {
    id,
    slug: `ws-${id}`,
    name: `ws-${id}`,
    description: null,
    icon_url: null,
    is_active: true,
    disciplines_enabled: disciplines,
    default_division_grid_versions: {},
    effective_division_grid_versions: {},
  } as Workspace;
}

let root: Root;
let container: HTMLElement;

const click = (selector: string) =>
  act(async () => {
    container.querySelector(selector)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
const probe = () => container.querySelector("[data-override-open]");

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <AchievementsPage />
      </QueryClientProvider>
    );
  });
  await act(() => new Promise<void>((done) => setTimeout(done, 0)));
}

afterEach(async () => {
  await act(async () => root.unmount());
});

beforeEach(() => {
  mocks.createAchievementOverride.mockReset().mockResolvedValue({});
  mocks.seedAchievementRules.mockReset().mockResolvedValue({ seeded: 0, removed: 0 });
  mocks.disciplines = [
    { code: "overwatch", name: "Overwatch", enabled: true },
    { code: "lol", name: "League of Legends", enabled: true },
  ];
  navigation.reset("/admin/achievements");
  document.body.innerHTML = "";
  document.cookie = "owt-discipline=; Max-Age=0; path=/";
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  useWorkspaceStore.setState({
    workspaces: [workspace(7, ["overwatch", "lol"]), workspace(8, ["lol"])],
    currentWorkspaceId: 7,
    statsScope: "workspace",
    browsingDiscipline: null,
    hostLockedWorkspaceId: null,
    entityWorkspaceId: null,
  });
});

describe("the achievements page keeps each game's drafts to that game", () => {
  it("drops an override draft filled for Overwatch when the game is switched to League", async () => {
    await mount();
    await click("[data-fill]");
    expect(probe()?.getAttribute("data-draft-rule")).toBe("11");

    await click("[data-pick=lol]");

    expect(probe()?.getAttribute("data-draft-rule")).toBe("");
    expect(probe()?.getAttribute("data-override-open")).toBe("false");
  });

  it("refuses to submit a rule that is not in the selected game's catalogue and sends nothing", async () => {
    await mount();
    await click("[data-pick=lol]");
    await click("[data-fill]"); // rule 11 is Overwatch's; League's catalogue holds only 21
    await click("[data-submit]");

    expect(mocks.createAchievementOverride).not.toHaveBeenCalled();
    expect(container.querySelector("[role=alert]")?.textContent).toContain("belongs to another game");
  });

  it("still submits a rule of the selected game", async () => {
    await mount();
    await click("[data-fill]");
    await click("[data-submit]");

    expect(mocks.createAchievementOverride).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ achievement_rule_id: 11, user_id: 1 })
    );
  });

  it("shows the actionable unavailable state, and no page, when the workspace has no game enabled", async () => {
    mocks.disciplines = [{ code: "overwatch", name: "Overwatch", enabled: false }];
    await mount();

    expect(container.querySelector("[data-unavailable=empty]")).not.toBeNull();
    expect(probe()).toBeNull();
  });

  it("shows the error, not another game, for an explicit game the workspace does not run", async () => {
    navigation.reset("/admin/achievements?discipline=starcraft");
    await mount();

    expect(container.querySelector("[data-unavailable=invalid]")).not.toBeNull();
    expect(probe()).toBeNull();
    expect(navigation.current()).toBe("/admin/achievements?discipline=starcraft");
  });

  it("follows the page's workspace when its games arrive after the id is already known", async () => {
    mocks.disciplines = [];
    await mount();
    expect(container.querySelector("[data-unavailable=empty]")).not.toBeNull();

    mocks.disciplines = [{ code: "lol", name: "League of Legends", enabled: true }];
    await act(async () => useWorkspaceStore.getState().setCurrentWorkspace(8));
    await act(() => new Promise<void>((done) => setTimeout(done, 0)));

    expect(container.querySelector("[data-unavailable]")).toBeNull();
    expect(probe()).not.toBeNull();
  });
});
