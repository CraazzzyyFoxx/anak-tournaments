// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConditionFlowEditor } from "@/components/admin/achievements/ConditionFlowEditor";
import type { ConditionTypeInfo } from "@/types/admin.types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { getConditionTypes } = vi.hoisted(() => ({ getConditionTypes: vi.fn() }));

vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>();
  const { default: en } = await import("@/i18n/messages/en.json");
  return {
    ...actual,
    useTranslations: (namespace?: string) =>
      actual.createTranslator({ locale: "en", messages: en, namespace: namespace as never })
  };
});
vi.mock("@/services/admin.service", () => ({ default: { getConditionTypes } }));
vi.mock("@/stores/workspace.store", () => ({
  useWorkspaceStore: (select: (state: { currentWorkspaceId: number }) => unknown) => select({ currentWorkspaceId: 7 })
}));
// The canvas needs layout the test DOM does not have; the editor's job is what it hands the canvas.
vi.mock("@/components/rule-builder", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/rule-builder")>()),
  RuleBuilder: ({
    readOnly,
    defaultLeafType,
    leafOptions,
    palette
  }: {
    readOnly?: boolean;
    defaultLeafType: string;
    leafOptions?: { value: string }[];
    palette?: { label: string; items: { leafType?: string; logicalOp?: string }[] }[];
  }) => (
    <div data-testid="builder" data-default={defaultLeafType} data-readonly={String(Boolean(readOnly))}>
      {(leafOptions ?? []).map((option) => (
        <i key={option.value} data-leaf-option={option.value} />
      ))}
      {(palette ?? []).map((group) => (
        <b key={group.label} data-group={group.label}>
          {group.items.map((item) => (
            <i key={item.leafType ?? item.logicalOp} data-palette-item={item.leafType ?? item.logicalOp} />
          ))}
        </b>
      ))}
    </div>
  )
}));

function condition(name: string, overrides: Partial<ConditionTypeInfo> = {}): ConditionTypeInfo {
  return {
    name,
    grain: "user",
    description: "",
    required_params: [],
    optional_params: [],
    depends_on: [],
    subcondition_only: false,
    subcondition_ok: false,
    ...overrides
  };
}

const OW_TYPES = [
  condition("match_win"),
  condition("stat_threshold"),
  condition("hero_kd_best"),
  condition("player_role", { subcondition_only: true })
];

let root: Root;
let container: HTMLElement;
let client: QueryClient;

/** Lets the query client deliver whatever has resolved so far. */
const settle = () => new Promise<void>((done) => setTimeout(done, 20));

async function render(node: ReactNode) {
  await act(async () => {
    root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  });
  // effects (and with them the requests) have started now; let what resolved reach the tree
  await act(settle);
}

function editor(discipline: string, props: { readOnly?: boolean; value?: Record<string, unknown> } = {}) {
  return <ConditionFlowEditor value={props.value ?? {}} onChange={() => {}} readOnly={props.readOnly} discipline={discipline} />;
}

const attr = (name: string, value?: string) =>
  [...container.querySelectorAll(`[data-${name}${value === undefined ? "" : `="${value}"`}]`)].map((el) =>
    el.getAttribute(`data-${name}`)
  );

beforeEach(() => {
  getConditionTypes.mockReset();
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe("the condition editor follows the game's registry", () => {
  it("asks for the registry of the discipline it was given", async () => {
    getConditionTypes.mockResolvedValue(OW_TYPES);
    await render(editor("overwatch"));
    expect(getConditionTypes).toHaveBeenCalledWith(7, "overwatch");
  });

  it("offers the leaf selector and palette only the returned top-level conditions", async () => {
    getConditionTypes.mockResolvedValue(OW_TYPES);
    await render(editor("overwatch"));
    expect(attr("leaf-option")).toEqual(["match_win", "stat_threshold", "hero_kd_best"]);
    const items = attr("palette-item");
    expect(items).toEqual(expect.arrayContaining(["AND", "OR", "NOT", "match_win", "stat_threshold", "hero_kd_best"]));
    expect(items).not.toContain("player_role");
    expect(items).not.toContain("global_winrate"); // a registered Overwatch node this registry did not return
  });

  it("starts a new node from a condition the game has, not the Overwatch one", async () => {
    getConditionTypes.mockResolvedValue([condition("lol_first_blood"), condition("lol_cs")]);
    await render(editor("lol"));
    expect(container.querySelector("[data-testid=builder]")?.getAttribute("data-default")).toBe("lol_first_blood");
    // a registry node the static palette has no entry for is still offered, under its own group
    expect(attr("palette-item")).toEqual(expect.arrayContaining(["lol_first_blood", "lol_cs"]));
    expect(attr("palette-item")).not.toContain("match_win");
  });

  it("shows an unavailable state with no addition for a game without conditions, never a default node", async () => {
    getConditionTypes.mockResolvedValue([]);
    await render(editor("lol"));
    expect(container.querySelector("[data-testid=builder]")).toBeNull();
    const status = container.querySelector("[role=status]");
    expect(status?.textContent).toContain("no achievement conditions yet");
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "Add condition")).toBe(false);
  });

  it("does not let a late Overwatch answer populate League after the game was switched", async () => {
    const overwatch = Promise.withResolvers<ConditionTypeInfo[]>();
    const lol = Promise.withResolvers<ConditionTypeInfo[]>();
    getConditionTypes.mockImplementation((_workspace: number, discipline: string) =>
      discipline === "overwatch" ? overwatch.promise : lol.promise
    );

    await render(editor("overwatch"));
    await render(editor("lol")); // switched while the Overwatch request is still pending
    expect(container.querySelector("[data-testid=builder]")).toBeNull();

    await act(async () => {
      overwatch.resolve(OW_TYPES);
      await settle();
    }); // the late answer lands
    expect(container.querySelector("[data-testid=builder]")).toBeNull();
    expect(container.querySelector("[aria-busy=true]")).not.toBeNull();

    await act(async () => {
      lol.resolve([]);
      await settle();
    }); // League's own answer: no conditions
    expect(container.querySelector("[data-testid=builder]")).toBeNull();
    expect(container.querySelector("[role=status]")?.textContent).toContain("no achievement conditions yet");
    expect(getConditionTypes.mock.calls.map((call) => call[1])).toEqual(["overwatch", "lol"]);

    // the late Overwatch data was cached under Overwatch, where it belongs
    await render(editor("overwatch"));
    expect(attr("leaf-option")).toContain("hero_kd_best");
  });

  it("reports a failed registry request instead of drawing a default node, and retries it", async () => {
    getConditionTypes.mockRejectedValue(new Error("boom"));
    await render(editor("lol"));
    expect(container.querySelector("[data-testid=builder]")).toBeNull();
    expect(container.querySelector("[role=alert]")?.textContent).toContain("could not be loaded");

    getConditionTypes.mockResolvedValue([condition("lol_first_blood")]);
    const retry = [...container.querySelectorAll("button")].find((button) => button.textContent === "Retry");
    await act(async () => {
      retry!.click();
      await settle();
    });
    expect(container.querySelector("[data-testid=builder]")?.getAttribute("data-default")).toBe("lol_first_blood");
  });

  it("keeps rendering an existing tree read-only without asking for the registry", async () => {
    getConditionTypes.mockReturnValue(new Promise(() => {}));
    await render(editor("overwatch", { readOnly: true, value: { AND: [{ type: "match_win", params: {} }] } }));
    const builder = container.querySelector("[data-testid=builder]");
    expect(builder?.getAttribute("data-readonly")).toBe("true");
    expect(getConditionTypes).not.toHaveBeenCalled();
  });

  it("draws an empty read-only tree of a game without conditions as unavailable, not as a default node", async () => {
    getConditionTypes.mockResolvedValue([]);
    await render(editor("lol", { readOnly: true }));
    expect(container.querySelector("[data-testid=builder]")).toBeNull();
    expect(container.querySelector("[role=status]")).not.toBeNull();
  });
});
