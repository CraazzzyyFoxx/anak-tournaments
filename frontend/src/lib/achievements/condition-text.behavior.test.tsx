// @vitest-environment happy-dom
//
// `useConditionText` names a condition's character and role from the rule's OWN game: the same slug or role param in
// two games reads each game's own catalog / ontology name, and a tree naming neither reads nothing.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/i18n/messages/en.json";
import { disciplineServiceMock } from "@/test/discipline-metadata";
import type { ConditionNode } from "@/types/achievement.types";
import type { WorkspaceAxis } from "@/lib/site/discipline-scope";

import { useConditionText } from "./condition-text";

const catalog = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/services/catalog.service", () => ({ default: catalog }));
// Metadata per axis: workspace 5 is a community with its own child role under Overwatch's tank.
const WORKSPACE = 5;
const metadata = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/services/discipline.service", () => ({
  default: { list: disciplineServiceMock.default.list, metadata: metadata.read }
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const NAMES: Record<string, string> = { overwatch: "Ana Amari", lol: "Annie Hastur" };
const TREE: ConditionNode = { type: "hero_kd_best", params: { hero_slug: "ana", min_time: 600, min_matches: 3 } };

let root: Root | null = null;
let container: HTMLElement;

function Line({
  tree,
  discipline,
  id,
  axis = "all"
}: Readonly<{ tree: ConditionNode; discipline: string; id?: string; axis?: WorkspaceAxis }>) {
  const { describe } = useConditionText(tree, discipline, axis);
  return <p data-game={id ?? discipline}>{describe(tree).text}</p>;
}

async function render(nodes: Array<{ tree: ConditionNode; discipline: string; id?: string; axis?: WorkspaceAxis }>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root = createRoot(container);
    root.render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={messages}>
          {nodes.map((node) => (
            <Line key={node.id ?? node.discipline} {...node} />
          ))}
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  });
  for (let turn = 0; turn < 5; turn += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
}

const text = (game: string) => container.querySelector(`[data-game=${game}]`)?.textContent ?? "";

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  catalog.list.mockReset().mockImplementation(async (discipline: string) => ({
    results: [{ id: 1, discipline, kind: "character", slug: "ana", name: NAMES[discipline] }],
    total: 1,
    page: 1,
    per_page: -1
  }));
  metadata.read.mockReset().mockImplementation(async (axis: WorkspaceAxis, code: string) => {
    const game = await disciplineServiceMock.default.metadata(axis, code);
    if (axis !== WORKSPACE || code !== "overwatch") return game;
    const child = { ...game.roles[0], id: 99, code: "main_tank", name: "Main tank", parent_id: 1, workspace_id: WORKSPACE };
    return { ...game, workspace_id: WORKSPACE, roles: [...game.roles, child] };
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
});

describe("useConditionText", () => {
  it("names the same slug from each rule's own game catalog", async () => {
    await render([
      { tree: TREE, discipline: "overwatch" },
      { tree: TREE, discipline: "lol" }
    ]);

    expect(text("overwatch")).toContain("Ana Amari");
    expect(text("lol")).toContain("Annie Hastur");
    expect(text("lol")).not.toContain("Ana Amari");
    expect(catalog.list.mock.calls.map(([discipline, kind]) => [discipline, kind]).sort()).toEqual([
      ["lol", "character"],
      ["overwatch", "character"]
    ]);
  });

  it("reads no catalog for a tree that names no character", async () => {
    await render([{ tree: { type: "match_win", params: {} }, discipline: "overwatch" }]);

    expect(text("overwatch")).not.toBe("");
    expect(catalog.list).not.toHaveBeenCalled();
  });

  it("names a role from the rule's own game ontology, compared lower-cased as the engine does", async () => {
    // Overwatch knows `tank`, League knows `jungle`: each game reads its own name, and a role the game does not
    // have stays as written — never another game's name, never a humanized guess.
    const role = (value: string): ConditionNode => ({ type: "player_role", params: { role: value } });
    await render([
      { id: "ow-tank", tree: role("TANK"), discipline: "overwatch" },
      { id: "ow-jungle", tree: role("jungle"), discipline: "overwatch" },
      { id: "lol-jungle", tree: role("jungle"), discipline: "lol" },
      { id: "lol-tank", tree: role("TANK"), discipline: "lol" }
    ]);

    expect(text("ow-tank")).toBe("Plays Tank");
    expect(text("ow-jungle")).toBe("Plays jungle");
    expect(text("lol-jungle")).toBe("Plays Jungle");
    expect(text("lol-tank")).toBe("Plays TANK");
  });

  it("resolves a workspace's child role in the caller's axis, and reads metadata on that axis only", async () => {
    const tree: ConditionNode = { type: "player_role", params: { role: "main_tank" } };
    await render([
      { id: "tenant", tree, discipline: "overwatch", axis: WORKSPACE },
      { id: "global", tree, discipline: "overwatch", axis: "all" }
    ]);

    expect(text("tenant")).toBe("Plays Main tank");
    // The global module ontology has no such child: it stays as written.
    expect(text("global")).toBe("Plays main_tank");
    expect(metadata.read.mock.calls.map(([axis, code]) => [axis, code]).sort()).toEqual([
      [WORKSPACE, "overwatch"],
      ["all", "overwatch"]
    ]);
  });
});
