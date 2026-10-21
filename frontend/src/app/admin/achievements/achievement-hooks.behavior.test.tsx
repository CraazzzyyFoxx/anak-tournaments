// @vitest-environment happy-dom
import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceStore } from "@/stores/workspace.store";
import { LOL_GAME, OW_GAME } from "@/test/game-scope";
import type { AchievementRule } from "@/types/admin.types";

import { AchievementFormDialog } from "./_components/AchievementFormDialog";
import { useAchievementRuleActions } from "./_hooks/useAchievementRuleActions";
import { useAchievementRuleForm, type AchievementRuleForm } from "./_hooks/useAchievementRuleForm";
import { useAchievementDetailMutations } from "./[id]/_hooks/useAchievementDetail";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const service = vi.hoisted(() => ({
  createAchievementRule: vi.fn(),
  updateAchievementRule: vi.fn(),
  uploadAchievementImage: vi.fn(),
  importAchievementRules: vi.fn(),
  seedAchievementRules: vi.fn(),
  hardResetAchievementRules: vi.fn(),
  evaluateAchievements: vi.fn(),
  exportAchievementRules: vi.fn(),
  deleteAchievementRule: vi.fn(),
  getCatalogCharacters: vi.fn(),
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
vi.mock("@/services/admin.service", () => ({ default: service }));
vi.mock("next/navigation", async () => (await import("@/test/url-navigation")).nextNavigationMock);

const RULE: AchievementRule = {
  id: 5,
  workspace_id: 7,
  slug: "ahri-main",
  name: "Ahri main",
  description_ru: "ru",
  description_en: "en",
  image_url: null,
  discipline: "lol",
  entity_id: 321,
  category: "hero",
  scope: "global",
  grain: "user",
  condition_tree: {},
  depends_on: [],
  enabled: true,
  rule_version: 1,
  min_tournament_id: null,
  created_at: "2026-10-18T00:00:00Z",
  updated_at: null,
};

/** The slice of the actions hook these tests read. */
interface ActionsUnderTest {
  importResult: unknown;
  importError: string | null;
  seed: () => void;
  hardReset: () => void;
  importRulesFromFile: (file: File) => Promise<void>;
  exportRules: () => Promise<void>;
  evaluate: (tournamentId: number | undefined, ruleIds: Set<number>) => void;
  toggle: (rule: AchievementRule, enabled: boolean) => void;
}

let root: Root;
let client: QueryClient;
let invalidate: ReturnType<typeof vi.spyOn>;

function Harness({ use }: Readonly<{ use: () => void }>): ReactNode {
  use();
  return null;
}

function mount(use: () => void) {
  return act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Harness use={use} />
      </QueryClientProvider>
    );
  });
}

const invalidatedKeys = () => invalidate.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey);

afterEach(async () => {
  // A root left mounted would keep re-rendering its probe into the shared `form`/`actions` variables.
  await act(async () => root.unmount());
});

beforeEach(() => {
  for (const fn of Object.values(service)) fn.mockReset();
  document.body.innerHTML = "";
  root = createRoot(document.body.appendChild(document.createElement("div")));
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  invalidate = vi.spyOn(client, "invalidateQueries");
});

describe("the rule form is scoped to a discipline", () => {
  let form: AchievementRuleForm;
  const useForm = (discipline: string | null) =>
    function useFormProbe() {
      form = useAchievementRuleForm(7, discipline);
    };
  const submit = () => act(async () => form.submit({ preventDefault() {} } as never));

  it("creates a rule in the selected game and refreshes that game's list", async () => {
    service.createAchievementRule.mockResolvedValue({ ...RULE, id: 9 });
    await mount(useForm("lol"));
    await act(async () => form.openCreate());
    await act(async () => form.setFormData({ ...form.formData, slug: "new", name: "New", entity_id: 12 }));
    await submit();

    expect(service.createAchievementRule).toHaveBeenCalledWith(7, expect.objectContaining({ discipline: "lol", entity_id: 12 }));
    expect(invalidatedKeys()).toContainEqual(["admin", "achievements", 7, "lol"]);
    expect(invalidatedKeys()).toContainEqual(["achievements", "all"]);
    expect(invalidatedKeys()).not.toContainEqual(["admin", "achievements", 7, "overwatch"]);
  });

  it("opens a new form for the game selected now, with nothing left from an earlier one", async () => {
    await mount(useForm("overwatch"));
    await act(async () => form.openCreate());
    await act(async () => form.setFormData({ ...form.formData, name: "Draft", entity_id: 77 }));
    await act(async () => form.reset());

    await mount(useForm("lol"));
    await act(async () => form.openCreate());
    expect(form.formData).toMatchObject({ discipline: "lol", name: "", entity_id: null });
    expect(form.isDirty).toBe(false);
  });

  it("keeps an open draft in its own game when the page's game changes", async () => {
    service.createAchievementRule.mockResolvedValue({ ...RULE, discipline: "overwatch" });
    await mount(useForm("overwatch"));
    await act(async () => form.openCreate());
    await act(async () => form.setFormData({ ...form.formData, slug: "s", name: "n" }));

    await mount(useForm("lol")); // the page switched games underneath the open dialog
    expect(form.discipline).toBe("overwatch");
    expect(form.isDirty).toBe(true); // the unsaved draft is still there for the dialog's own prompt
    await submit();
    expect(service.createAchievementRule).toHaveBeenCalledWith(7, expect.objectContaining({ discipline: "overwatch" }));
  });

  it("opens, edits and saves a rule keeping its entity and its immutable discipline", async () => {
    service.updateAchievementRule.mockResolvedValue(RULE);
    await mount(useForm("overwatch")); // the page is on another game than the rule
    await act(async () => form.openEdit(RULE));
    expect(form.discipline).toBe("lol");
    expect(form.formData).toMatchObject({ entity_id: 321, slug: "ahri-main" });
    expect(form.isDirty).toBe(false);

    await act(async () => form.setFormData({ ...form.formData, name: "Renamed" }));
    await submit();

    const [workspace, ruleId, body] = service.updateAchievementRule.mock.calls[0];
    expect([workspace, ruleId]).toEqual([7, 5]);
    expect(body).toMatchObject({ name: "Renamed", entity_id: 321 });
    expect(body).not.toHaveProperty("discipline");
    expect(body).not.toHaveProperty("hero_id");
    expect(invalidatedKeys()).toContainEqual(["admin", "achievements", 7, "lol"]);
  });

  it("does not open a create form when the workspace has no game to create in", async () => {
    await mount(useForm(null));
    await act(async () => form.openCreate());
    expect(form.open).toBe(false);
  });

  it("moves a create draft to the game picked in its field and drops the other game's character", async () => {
    await mount(useForm("overwatch"));
    await act(async () => form.openCreate());
    await act(async () => form.setFormData({ ...form.formData, name: "Draft", entity_id: 77 }));
    await act(async () => form.chooseDiscipline("lol"));

    expect(form.discipline).toBe("lol");
    expect(form.formData).toMatchObject({ discipline: "lol", name: "Draft", entity_id: null });
  });

  it("keeps the draft's character when its own game is pressed again in the game field", async () => {
    useWorkspaceStore.setState({ currentWorkspaceId: 7 });
    service.getCatalogCharacters.mockResolvedValue([{ id: 77, name: "Tracer", active: true }]);
    function DialogProbe() {
      const dialogForm = useAchievementRuleForm(7, "overwatch");
      useEffect(() => {
        form = dialogForm;
      });
      return <AchievementFormDialog form={dialogForm} games={[OW_GAME, LOL_GAME]} />;
    }
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <DialogProbe />
        </QueryClientProvider>
      );
    });
    await act(async () => form.openCreate());
    // The character is one the game's catalog offers, as when it is picked in the field.
    await act(() => new Promise<void>((done) => setTimeout(done, 0)));
    await act(async () => form.setFormData({ ...form.formData, name: "Draft", entity_id: 77 }));
    expect(form.formData.entity_id).toBe(77);

    const field = document.getElementById("rule-game")!;
    expect(field.textContent).toContain("Overwatch");
    await act(async () => field.click());
    const overwatch = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) =>
      option.textContent?.includes("Overwatch")
    );
    await act(async () => overwatch!.click());

    expect(form.formData).toMatchObject({ discipline: "overwatch", name: "Draft", entity_id: 77 });
  });
});

describe("the achievement actions are scoped to a discipline", () => {
  let actions: ActionsUnderTest;
  const useActions = (discipline: string | null) =>
    function useActionsProbe() {
      actions = useAchievementRuleActions({
        workspaceId: 7,
        discipline,
        onDeleted: () => {},
        onEvaluated: () => {},
      });
    };
  const file = (content: unknown) => new File([typeof content === "string" ? content : JSON.stringify(content)], "rules.json");
  const importFile = (content: unknown) => act(async () => actions.importRulesFromFile(file(content)));

  it("seeds, resets and evaluates in the selected game only", async () => {
    service.seedAchievementRules.mockResolvedValue({ seeded: 0, removed: 0 });
    service.hardResetAchievementRules.mockResolvedValue({ seeded: 0, removed: 0, cleared_results: 0, run: { id: "r" } });
    service.evaluateAchievements.mockResolvedValue({ id: "run" });
    await mount(useActions("lol"));

    await act(async () => actions.seed());
    await act(async () => actions.hardReset());
    await act(async () => actions.evaluate(3, new Set([5])));

    expect(service.seedAchievementRules).toHaveBeenCalledWith(7, "lol");
    expect(service.hardResetAchievementRules).toHaveBeenCalledWith(7, "lol");
    expect(service.evaluateAchievements).toHaveBeenCalledWith(7, "lol", { tournament_id: 3, rule_ids: [5] });
    expect(invalidatedKeys()).toContainEqual(["admin", "overrides", 7, "all", "lol"]);
    expect(invalidatedKeys()).not.toContainEqual(["admin", "achievements", 7, "overwatch"]);
  });

  it("toggles a rule in its own game under all games and refreshes both lists", async () => {
    service.updateAchievementRule.mockResolvedValue(RULE);
    await mount(useActions(null));
    await act(async () => actions.toggle(RULE, false));

    expect(service.updateAchievementRule).toHaveBeenCalledWith(7, 5, { enabled: false });
    expect(invalidatedKeys()).toContainEqual(["admin", "achievements", 7, "lol"]);
    expect(invalidatedKeys()).toContainEqual(["admin", "achievements", 7, "all"]);
  });

  it("finishes a seed against the game it started in when another game is selected meanwhile", async () => {
    const pending = Promise.withResolvers<{ seeded: number; removed: number }>();
    service.seedAchievementRules.mockReturnValue(pending.promise);
    await mount(useActions("overwatch"));
    await act(async () => actions.seed());
    await mount(useActions("lol")); // the page switched games while the seed is still running
    await act(async () => {
      pending.resolve({ seeded: 1, removed: 0 });
      await pending.promise;
    });

    expect(service.seedAchievementRules).toHaveBeenCalledWith(7, "overwatch");
    expect(invalidatedKeys()).toContainEqual(["admin", "achievements", 7, "overwatch"]);
    expect(invalidatedKeys()).not.toContainEqual(["admin", "achievements", 7, "lol"]);
  });

  it("clears the started game's overrides after a reset, not the selected game's", async () => {
    const pending = Promise.withResolvers<unknown>();
    service.hardResetAchievementRules.mockReturnValue(pending.promise);
    await mount(useActions("overwatch"));
    await act(async () => actions.hardReset());
    await mount(useActions("lol"));
    await act(async () => {
      pending.resolve({ seeded: 0, removed: 0, cleared_results: 0, run: { id: "r" } });
      await pending.promise;
      await new Promise<void>((done) => setTimeout(done, 20)); // let the mutation observer deliver onSuccess
    });

    expect(invalidatedKeys()).toContainEqual(["admin", "overrides", 7, "all", "overwatch"]);
    expect(invalidatedKeys()).not.toContainEqual(["admin", "overrides", 7, "all", "lol"]);
  });

  it("exports the selected game's rules", async () => {
    service.exportAchievementRules.mockResolvedValue({ blob: new Blob(["{}"]), filename: "x.json", data: {} });
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    await mount(useActions("lol"));
    await act(async () => actions.exportRules());
    expect(service.exportAchievementRules).toHaveBeenCalledWith(7, "lol");
  });

  it("imports a portable v2 file as read and reports success", async () => {
    const envelope = { schema_version: 2, exported_at: "now", source_workspace: null, rules: [{ slug: "a", discipline: "lol", entity_id: 4 }] };
    service.importAchievementRules.mockResolvedValue({ created: 1, updated: 0, warnings: [] });
    await mount(useActions("lol"));
    await importFile(envelope);

    expect(service.importAchievementRules).toHaveBeenCalledWith(7, envelope);
    expect(actions.importResult).toEqual({ created: 1, updated: 0, warnings: [] });
    expect(actions.importError).toBeNull();
    expect(invalidatedKeys()).toContainEqual(["admin", "achievements", 7]);
  });

  it("rejects a v1 file visibly, without a request, a success report or a converted payload", async () => {
    await mount(useActions("lol"));
    await importFile({ schema_version: 1, rules: [{ slug: "old", hero_id: 3 }] });

    expect(service.importAchievementRules).not.toHaveBeenCalled();
    expect(actions.importResult).toBeNull();
    expect(actions.importError).toContain("export format 1");
    expect(actions.importError).toContain("Nothing was imported");
  });

  it("rejects a v2 file that still carries hero_id and names the rule", async () => {
    await mount(useActions("lol"));
    await importFile({ schema_version: 2, rules: [{ slug: "legacy", discipline: "lol", hero_id: 3 }] });

    expect(service.importAchievementRules).not.toHaveBeenCalled();
    expect(actions.importError).toContain("hero_id");
    expect(actions.importError).toContain("legacy");
  });

  it("shows the server's refusal of a missing or foreign entity and claims no success", async () => {
    const refusal = "entity_id: 99 is not a character of lol";
    service.importAchievementRules.mockRejectedValue(new Error(refusal));
    await mount(useActions("lol"));
    await importFile({ schema_version: 2, rules: [{ slug: "a", discipline: "lol", entity_id: 99 }] });

    expect(service.importAchievementRules).toHaveBeenCalledTimes(1);
    expect(actions.importError).toBe(refusal);
    expect(actions.importResult).toBeNull();
    expect(invalidatedKeys()).not.toContainEqual(["admin", "achievements", 7]);
  });

  it("reports text that is not JSON", async () => {
    await mount(useActions("lol"));
    await importFile("{nope");
    expect(service.importAchievementRules).not.toHaveBeenCalled();
    expect(actions.importError).toContain("not valid JSON");
  });
});

describe("the rule page's writes", () => {
  let mutations: ReturnType<typeof useAchievementDetailMutations>;
  const useDetail = () =>
    function useDetailProbe() {
      mutations = useAchievementDetailMutations({
        workspaceId: 7,
        ruleId: 5,
        discipline: "lol",
        onTreeSaved: () => undefined,
        onOverrideSaved: () => undefined,
        onOverrideRemoved: () => undefined,
        onDeleted: () => undefined,
      });
    };

  it("stales every game's rule list after a condition save, a toggle and a delete", async () => {
    service.updateAchievementRule.mockResolvedValue(RULE);
    service.deleteAchievementRule.mockResolvedValue(undefined);
    await mount(useDetail());

    await act(async () => {
      await mutations.saveTreeMutation.mutateAsync({ type: "and", children: [] });
    });
    await act(async () => {
      await mutations.toggleMutation.mutateAsync(false);
    });
    await act(async () => {
      await mutations.deleteMutation.mutateAsync();
    });

    // The rule shows on its game's list and on the all-games list: one prefix stales both (and every other game's).
    const everyGame = invalidatedKeys().filter((key) => JSON.stringify(key) === JSON.stringify(["admin", "achievements", 7]));
    expect(everyGame).toHaveLength(3);
    expect(invalidatedKeys()).not.toContainEqual(["admin", "achievements", 7, "lol"]);
  });
});
