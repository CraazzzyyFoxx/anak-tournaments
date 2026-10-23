// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { catalogQueryKeys } from "@/lib/catalog/query-keys";
import type { CatalogKind } from "@/types/catalog.types";

import { useCatalogEntityCrud } from "./useCatalogEntityCrud";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface Form {
  name: string;
}
interface Entity extends Form {
  id: number;
}
interface Actions {
  create: () => Promise<Entity>;
  update: () => Promise<Entity>;
  delete: () => Promise<void>;
}

const LOL = { discipline: "lol" };
const OW = { discipline: "overwatch" };
const KEYS = {
  lolMap: catalogQueryKeys.adminList(LOL, "map", {}),
  lolMapPublic: catalogQueryKeys.list(LOL, "map", {}),
  lolCharacter: catalogQueryKeys.adminList(LOL, "character", {}),
  owMap: catalogQueryKeys.adminList(OW, "map", {}),
  lolStats: ["character-stats", 7, "lol", "all"] as const,
  owStats: ["character-stats", 7, "overwatch", "all"] as const,
  unrelated: ["admin", "settings"] as const
};

let client: QueryClient;
let container: HTMLDivElement;
let root: Root;
let actions: Actions;
let release: (() => void) | null;

function Catalog({ discipline, kind }: Readonly<{ discipline: string; kind: CatalogKind }>) {
  const crud = useCatalogEntityCrud<Entity, Form, Form>({
    discipline,
    kind,
    emptyForm: { name: "" },
    getForm: (entity) => ({ name: entity?.name ?? "" }),
    service: {
      // Held open until the test releases it, so the view can change games while the request is in flight.
      create: async (_d, _k, form) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { id: 2, ...form };
      },
      update: async (_d, _k, id, form) => ({ id, ...form }),
      delete: async () => undefined
    }
  });
  useEffect(() => {
    actions = {
      create: () => crud.createMutation.mutateAsync({ scope: { discipline, kind }, data: { name: "Ilios" } }),
      update: () => crud.updateMutation.mutateAsync({ scope: { discipline, kind }, id: 1, data: { name: "Ilios" } }),
      delete: () => crud.deleteMutation.mutateAsync({ scope: { discipline, kind }, id: 1 })
    };
  });
  return null;
}

const render = (discipline: string, kind: CatalogKind = "map") =>
  act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Catalog discipline={discipline} kind={kind} />
      </QueryClientProvider>
    );
  });

const invalidated = (key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated === true;

beforeEach(async () => {
  release = null;
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  for (const key of Object.values(KEYS)) client.setQueryData(key, []);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await render("lol");
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
});

describe("catalog mutation invalidation", () => {
  it.each(["update", "delete"] as const)("keeps %s invalidation to that game's kind", async (operation) => {
    await act(async () => {
      await actions[operation]();
    });
    expect(invalidated(KEYS.lolMap)).toBe(true);
    expect(invalidated(KEYS.lolMapPublic)).toBe(true);
    for (const key of [KEYS.lolCharacter, KEYS.owMap, KEYS.lolStats, KEYS.unrelated]) expect(invalidated(key)).toBe(false);
  });

  it("invalidates the game and kind a create was submitted for, even if the view changed before it settled", async () => {
    let pending: Promise<Entity> | undefined;
    await act(async () => {
      pending = actions.create();
    });
    await render("overwatch", "character");
    await act(async () => {
      release?.();
      await pending;
    });
    expect(invalidated(KEYS.lolMap)).toBe(true);
    expect(invalidated(KEYS.owMap)).toBe(false);
    expect(invalidated(KEYS.lolCharacter)).toBe(false);
  });
});
