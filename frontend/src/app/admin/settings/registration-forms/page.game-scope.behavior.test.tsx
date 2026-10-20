// @vitest-environment happy-dom
//
// Workspace templates as a multi page (spec §6.13, §8.4): every game's templates (marked) under "all games", one
// game's under a game; a selected template is an owner whose game names its roles; a new template is filed under
// the creation game with that game's identity question.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import type { DisciplineDescriptor } from "@/types/discipline.types";
import type { FormSchema } from "@/types/forms.types";

import Page from "./page";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as never;

const OW = { code: "overwatch", name: "Overwatch", short_name: "OW", icon: null, enabled: true, identity_provider: "battlenet" } as DisciplineDescriptor;
const LOL = { code: "lol", name: "League of Legends", short_name: "LoL", icon: null, enabled: true, identity_provider: "riot" } as DisciplineDescriptor;

/** The saved scope's game (`null`: all games). */
let game: string | null = null;
/** An explicit `?discipline=` narrowing the page past the saved scope. */
let urlGame: string | null = null;
const listTemplates = vi.fn();
const createTemplate = vi.fn<(workspaceId: number, name: string, discipline: string, schema: FormSchema) => unknown>();
const getPlayerSubRoles = vi.fn();

vi.mock("@/services/registration-form-templates.service", () => ({
  default: {
    list: (...args: unknown[]) => listTemplates(...args),
    create: (...args: Parameters<typeof createTemplate>) => createTemplate(...args),
    update: vi.fn(),
    remove: vi.fn()
  }
}));
vi.mock("@/services/admin.service", () => ({
  default: { getPlayerSubRoles: (...args: unknown[]) => getPlayerSubRoles(...args) }
}));
vi.mock("@/stores/workspace.store", () => ({
  useWorkspaceStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ currentWorkspaceId: 1, lastGame: null, setEntityWorkspace: vi.fn(), setEntityDiscipline: vi.fn() })
}));
vi.mock("@/hooks/useEntityWorkspace", () => ({ useEntityWorkspace: vi.fn() }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ canAccessPermission: () => true }) }));
vi.mock("@/hooks/useGameScope", () => ({
  useGameScope: () => {
    const shown = urlGame ?? game;
    return {
      axis: 1,
      games: [OW, LOL],
      resolution:
        shown === null
          ? { game: { kind: "all" }, pill: { kind: "all" }, tabs: false, scope: "all" }
          : {
              game: { kind: "game", code: shown, source: urlGame === null ? "scope" : "url" },
              pill: { kind: "game", code: shown, locked: false },
              tabs: false,
              scope: game ?? "all"
            },
      game: shown,
      isError: false,
      refetch: vi.fn(),
      selectScope: vi.fn(),
      selectTab: vi.fn()
    };
  }
}));
vi.mock("@/hooks/useGameDescriptors", () => ({
  useGameDescriptors: () => new Map([[OW.code, OW], [LOL.code, LOL]])
}));
vi.mock("@/hooks/useDisciplineMetadata", () => ({
  useDisciplineMetadata: () => ({ data: undefined, isError: false, refetch: vi.fn() })
}));
vi.mock("@/lib/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), apiError: vi.fn() }
}));
let rerender: (() => void) | null = null;
const push = vi.fn((url: string) => {
  window.history.replaceState(null, "", url);
  rerender?.();
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: push, back: vi.fn() }),
  usePathname: () => window.location.pathname,
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(window.location.search)
}));

const template = (id: number, name: string, discipline: string) => ({
  id,
  workspace_id: 1,
  discipline,
  name,
  updated_at: "2026-01-01",
  form_schema: { schema_version: 1, sections: [{ key: "accounts", title: name, description: null, fields: [] }] }
});

let container: HTMLDivElement;
let root: Root;

async function settle(times = 8) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
}

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  rerender = () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={en}>
        <QueryClientProvider client={client}>
          <Page />
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
  await act(async () => rerender!());
  await settle();
}

function buttonNamed(text: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>("button")].find(
    (element) => (element.textContent ?? "").trim() === text
  );
  if (!found) throw new Error(`no button named "${text}"`);
  return found;
}

/** Types a name into "New template" and adds it; resolves to what was created: name, game, question keys. */
async function createNamed(text: string) {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${en.adminSettings.registrationForms.newTemplateName}"]`);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, text);
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => buttonNamed(en.adminSettings.registrationForms.add).click());
  await settle();

  expect(createTemplate).toHaveBeenCalledTimes(1);
  const [, name, discipline, schema] = createTemplate.mock.calls[0];
  return { name, discipline, keys: schema.sections.flatMap((section) => section.fields.map((field) => field.key)) };
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/admin/settings/registration-forms");
  game = null;
  urlGame = null;
  listTemplates.mockResolvedValue([template(11, "Open cup", "overwatch"), template(12, "Rift cup", "lol")]);
  getPlayerSubRoles.mockResolvedValue([]);
  createTemplate.mockImplementation(async (_ws: number, name: string, discipline: string) => template(13, name, discipline));
});

it("lists every game's templates with a mark each under all games", async () => {
  await mount();

  expect(listTemplates).toHaveBeenCalledWith(1, null);
  expect(container.querySelector('[title="Overwatch"]')).not.toBeNull();
  expect(container.querySelector('[title="League of Legends"]')).not.toBeNull();
});

it("reads a selected template's roles in its own game", async () => {
  await mount();

  await act(async () => buttonNamed("Rift cup").click());
  await settle();

  expect(getPlayerSubRoles).toHaveBeenLastCalledWith({ workspace_id: 1, discipline: "lol" }, expect.anything());
});

it("opens a selected template of another game than the list's", async () => {
  game = "lol";
  listTemplates.mockImplementation(async (_ws: number, discipline: string | null) =>
    discipline === "lol"
      ? [template(12, "Rift cup", "lol")]
      : [template(11, "Open cup", "overwatch"), template(12, "Rift cup", "lol")]
  );
  window.history.replaceState(null, "", "/admin/settings/registration-forms?template=11");
  await mount();

  // Resolved over every game's templates, then edited as its own game's owner.
  expect(listTemplates).toHaveBeenCalledWith(1, null);
  expect(getPlayerSubRoles).toHaveBeenLastCalledWith({ workspace_id: 1, discipline: "overwatch" }, expect.anything());
});

it("files a new template under the scope's game with that game's identity question", async () => {
  game = "lol";
  await mount();

  expect(listTemplates).toHaveBeenCalledWith(1, "lol");
  const created = await createNamed("Rift open");
  expect([created.name, created.discipline]).toEqual(["Rift open", "lol"]);
  expect(created.keys).toContain("identity_riot");
});

it("files a new template under the saved scope's game, not under a URL game that only narrows the list", async () => {
  game = "overwatch";
  urlGame = "lol";
  await mount();

  expect(listTemplates).toHaveBeenCalledWith(1, "lol");
  const created = await createNamed("Open two");
  expect(created.discipline).toBe("overwatch");
  expect(created.keys).toContain("identity_battlenet");
});

it("answers a failed lookup of a selected template of another game with an error and a retry", async () => {
  game = "lol";
  let lookupFails = true;
  listTemplates.mockImplementation(async (_ws: number, discipline: string | null) => {
    if (discipline === "lol") return [template(12, "Rift cup", "lol")];
    if (lookupFails) throw new Error("lookup failed");
    return [template(11, "Open cup", "overwatch"), template(12, "Rift cup", "lol")];
  });
  window.history.replaceState(null, "", "/admin/settings/registration-forms?template=11");
  await mount();

  expect(container.textContent).toContain(en.adminSettings.registrationForms.errors.load);
  expect(container.textContent).not.toContain(en.adminSettings.registrationForms.pickTitle);

  lookupFails = false;
  await act(async () => buttonNamed(en.common.retry).click());
  await settle();

  expect(container.textContent).not.toContain(en.adminSettings.registrationForms.errors.load);
  expect(getPlayerSubRoles).toHaveBeenLastCalledWith({ workspace_id: 1, discipline: "overwatch" }, expect.anything());
});
