// @vitest-environment happy-dom
//
// Rank features resolve their game first (owner > explicit ?discipline= > scope > last game > first enabled game, the
// shared resolver) and only then check the capability. Capability never chooses the game.
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PageClass } from "@/lib/site/discipline-scope";
import type { DisciplineDescriptor } from "@/types/discipline.types";

let search = "";
let stored = "overwatch";

const caps = (collects: boolean) => ({
  catalog_sync: true,
  native_rank_collection: collects,
  native_ladder: collects,
  achievement_conditions: collects,
  analytics: collects
});
const game = (code: string, collects: boolean, enabled = true): DisciplineDescriptor =>
  ({
    code,
    name: code,
    short_name: code,
    icon: null,
    enabled,
    kinds: {},
    character_classes: [],
    identity_provider: null,
    capabilities: caps(collects)
  }) as DisciplineDescriptor;
const INSTALLED = [game("overwatch", true), game("lol", false), game("old", true, false)];

// The real resolver over the URL and a saved scope: the collector's own logic is the subject.
vi.mock("@/hooks/useGameScope", async () => {
  const { resolvePageGame } = await vi.importActual<typeof import("@/lib/site/discipline-scope")>(
    "@/lib/site/discipline-scope"
  );
  return {
    useGameScope: (options: { pageClass: PageClass; ownerGame?: string | null }) => {
      const resolution = resolvePageGame({
        pageClass: options.pageClass,
        ownerGame: options.ownerGame ?? null,
        explicit: new URLSearchParams(search).get("discipline"),
        stored,
        lastGame: null,
        games: INSTALLED
      });
      return {
        axis: 1,
        games: INSTALLED,
        resolution,
        game: resolution.game.kind === "game" ? resolution.game.code : null,
        isError: false,
        refetch: () => {},
        selectScope: () => {},
        selectTab: () => {}
      };
    }
  };
});

import { useNativeRankCollector, type NativeRankCollector } from "./useNativeRankCollector";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const seen: { result?: NativeRankCollector } = {};
function Probe({ owner }: Readonly<{ owner?: string | null }>) {
  const collector = useNativeRankCollector(1, owner);
  useEffect(() => {
    seen.result = collector;
  });
  return null;
}

const containers: HTMLElement[] = [];
function run(owner?: string | null) {
  const container = document.createElement("div");
  containers.push(container);
  act(() => createRoot(container).render(<Probe owner={owner} />));
  return seen.result!;
}

beforeEach(() => {
  search = "";
  stored = "overwatch";
});
afterEach(() => containers.splice(0));

describe("useNativeRankCollector", () => {
  it("honours the explicit ?discipline= under the scope's game, then gates by capability", () => {
    search = "tab=ranks&discipline=lol";
    const lol = run();

    expect(lol.descriptor?.code).toBe("lol");
    expect(lol.supported).toBe(false);
  });

  it("falls back to the scope's game, and under all games to the first enabled one", () => {
    expect(run().descriptor?.code).toBe("overwatch");
    expect(run().supported).toBe(true);

    stored = "old"; // disabled: not a game the area runs, so the effective scope is all games
    expect(run().descriptor?.code).toBe("overwatch");
    stored = "all";
    expect(run().descriptor?.code).toBe("overwatch");
  });

  it("resolves an invalid explicit value to no game — never another game's history", () => {
    for (const bad of ["chess", "old"]) {
      search = `discipline=${bad}`;
      const outcome = run();
      expect(outcome.scope.resolution?.game.kind, bad).toBe("invalid");
      expect(outcome.descriptor, bad).toBeNull();
      expect(outcome.supported, bad).toBe(false);
    }
  });

  it("lets the owning game outrank the URL and the scope", () => {
    search = "discipline=overwatch";
    expect(run("lol").descriptor?.code).toBe("lol");
    expect(run("lol").supported).toBe(false);
    expect(run("chess").descriptor).toBeNull();
  });
});
