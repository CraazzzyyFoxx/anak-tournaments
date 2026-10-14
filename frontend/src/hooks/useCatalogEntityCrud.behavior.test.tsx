// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
  sync: () => Promise<unknown>;
}

const KEYS = {
  heroes: ["admin", "heroes", 1],
  maps: ["admin", "maps", 1],
  gamemodes: ["admin", "gamemodes", 1],
  options: ["admin", "gamemodes", "options"],
  unrelated: ["admin", "settings"]
};

let client: QueryClient;
let container: HTMLDivElement;
let root: Root;
let actions: Actions;
let modes: Entity[];

function Catalog() {
  const crud = useCatalogEntityCrud<Entity, Form, Form>({
    queryKey: ["admin", "maps"],
    emptyForm: { name: "" },
    getForm: (entity) => ({ name: entity?.name ?? "" }),
    service: {
      create: async (form) => ({ id: 2, ...form }),
      update: async (id, form) => ({ id, ...form }),
      delete: async () => undefined,
      sync: async () => {
        modes = [...modes, { id: 2, name: "New mode" }];
      }
    }
  });
  useEffect(() => {
    actions = {
      create: () => crud.createMutation.mutateAsync({ name: "Ilios" }),
      update: () => crud.updateMutation.mutateAsync({ id: 1, data: { name: "Ilios" } }),
      delete: () => crud.deleteMutation.mutateAsync(1),
      sync: () => crud.syncMutation.mutateAsync()
    };
  });
  const { data = [] } = useQuery({ queryKey: KEYS.options, queryFn: async () => modes });
  return <output>{data.map((mode) => mode.name).join(", ")}</output>;
}

beforeEach(async () => {
  modes = [{ id: 1, name: "Control" }];
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  for (const key of Object.values(KEYS)) client.setQueryData(key, []);
  client.setQueryData(KEYS.options, modes);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<QueryClientProvider client={client}><Catalog /></QueryClientProvider>);
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
});

describe("catalog mutation invalidation", () => {
  it("syncs every catalog prefix and refreshes the mounted mode options", async () => {
    expect(container.textContent).toBe("Control");
    await act(async () => {
      await actions.sync();
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
    for (const key of [KEYS.heroes, KEYS.maps, KEYS.gamemodes]) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
    expect(container.textContent).toBe("Control, New mode");
    expect(client.getQueryState(KEYS.unrelated)?.isInvalidated).toBe(false);
  });

  it.each(["create", "update", "delete"] as const)("keeps %s invalidation entity-specific", async (operation) => {
    await act(async () => {
      await actions[operation]();
    });
    expect(client.getQueryState(KEYS.maps)?.isInvalidated).toBe(true);
    for (const key of [KEYS.heroes, KEYS.gamemodes, KEYS.options, KEYS.unrelated]) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    }
    expect(container.textContent).toBe("Control");
  });
});
