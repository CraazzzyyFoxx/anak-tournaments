// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";

import { useWorkspaceStore } from "@/stores/workspace.store";
import type { Workspace } from "@/types/workspace.types";

import { useAchievementDiscipline } from "./useAchievementDiscipline";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function workspace(id: number, disciplines: string[]): Workspace {
  return { id, slug: `w${id}`, name: `w${id}`, disciplines_enabled: disciplines } as Workspace;
}

interface Selection {
  discipline: string | null;
  disciplines: string[];
  select: (discipline: string) => void;
}

let latest: Selection;

function Probe() {
  const selection = useAchievementDiscipline();
  useEffect(() => {
    latest = selection;
  });
  return null;
}

beforeEach(() => {
  document.body.innerHTML = "";
  useWorkspaceStore.setState({ workspaces: [], currentWorkspaceId: 7 });
});

describe("the selected achievement game", () => {
  it("appears when the workspace list loads after the id was already known", async () => {
    await act(async () => createRoot(document.body.appendChild(document.createElement("div"))).render(<Probe />));
    expect(latest.discipline).toBeNull();

    await act(async () => useWorkspaceStore.setState({ workspaces: [workspace(7, ["lol", "overwatch"])] }));
    expect(latest.discipline).toBe("lol");
    expect(latest.disciplines).toEqual(["lol", "overwatch"]);
  });

  it("keeps a pick while the game stays enabled and falls back when it is disabled", async () => {
    useWorkspaceStore.setState({ workspaces: [workspace(7, ["overwatch", "lol"])] });
    await act(async () => createRoot(document.body.appendChild(document.createElement("div"))).render(<Probe />));
    await act(async () => latest.select("lol"));
    expect(latest.discipline).toBe("lol");

    await act(async () => useWorkspaceStore.setState({ workspaces: [workspace(7, ["overwatch"])] }));
    expect(latest.discipline).toBe("overwatch");
  });

  it("drops a pick when the workspace changes", async () => {
    useWorkspaceStore.setState({ workspaces: [workspace(7, ["overwatch", "lol"]), workspace(8, ["overwatch", "lol"])] });
    await act(async () => createRoot(document.body.appendChild(document.createElement("div"))).render(<Probe />));
    await act(async () => latest.select("lol"));
    await act(async () => useWorkspaceStore.setState({ currentWorkspaceId: 8 }));
    expect(latest.discipline).toBe("overwatch");
  });
});
