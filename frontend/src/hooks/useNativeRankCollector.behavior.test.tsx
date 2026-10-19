// @vitest-environment happy-dom
//
// Rank features resolve their game first (owner > explicit ?discipline= > saved preference > first
// enabled game) and only then check the capability. Capability never chooses the game.
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DisciplineDescriptor } from "@/types/discipline.types";

let search = "";
let preference: string | null = "overwatch";

const caps = (collects: boolean) => ({
  catalog_sync: true,
  native_rank_collection: collects,
  native_ladder: collects,
  achievement_conditions: collects,
  analytics: collects
});
const game = (code: string, collects: boolean, enabled = true): DisciplineDescriptor => ({
  code,
  name: code,
  short_name: code.toUpperCase(),
  icon: null,
  enabled,
  kinds: {},
  character_classes: [],
  identity_provider: null,
  capabilities: caps(collects)
});
const INSTALLED = [game("overwatch", true), game("lol", false), game("old", true, false)];

const push = vi.fn();
const saveChoice = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/admin/people/42",
  useRouter: () => ({ push })
}));
vi.mock("@/hooks/useDisciplineMetadata", () => ({
  useDisciplines: () => ({ data: INSTALLED, isLoading: false, isError: false })
}));
vi.mock("@/stores/workspace.store", () => ({
  useWorkspaceStore: (
    selector: (state: {
      browsingDiscipline: string | null;
      setBrowsingDiscipline: (value: string) => void;
    }) => unknown
  ) => selector({ browsingDiscipline: preference, setBrowsingDiscipline: saveChoice })
}));

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
  preference = "overwatch";
});
afterEach(() => containers.splice(0));

describe("useNativeRankCollector", () => {
  it("honours the explicit ?discipline= over the saved preference, then gates by capability", () => {
    // /admin/people/42?tab=ranks&discipline=lol with an Overwatch preference
    search = "tab=ranks&discipline=lol";
    const lol = run();

    expect(lol.descriptor?.code).toBe("lol");
    expect(lol.supported).toBe(false);
  });

  it("falls back to the saved preference, and to nothing it cannot honour", () => {
    expect(run().descriptor?.code).toBe("overwatch");
    expect(run().supported).toBe(true);

    preference = "old"; // disabled: not a usable choice
    expect(run().descriptor?.code).toBe("overwatch");
  });

  it("resolves an invalid explicit value to no game — never another game's history", () => {
    for (const bad of ["chess", "all", "old", ""]) {
      search = `discipline=${bad}`;
      const outcome = run();
      expect(outcome.resolved?.kind, bad).toBe("invalid");
      expect(outcome.descriptor, bad).toBeNull();
      expect(outcome.supported, bad).toBe(false);
    }
  });

  it("selecting a game saves the choice and pushes it to ?discipline= as a history entry", () => {
    search = "tab=ranks&discipline=chess";
    run().select("overwatch");

    expect(saveChoice).toHaveBeenCalledWith("overwatch");
    expect(push).toHaveBeenCalledWith("/admin/people/42?tab=ranks&discipline=overwatch", { scroll: false });
  });

  it("lets the owning game outrank the URL and the preference", () => {
    search = "discipline=overwatch";
    expect(run("lol").descriptor?.code).toBe("lol");
    expect(run("lol").supported).toBe(false);
    expect(run("chess").descriptor).toBeNull();
  });
});
