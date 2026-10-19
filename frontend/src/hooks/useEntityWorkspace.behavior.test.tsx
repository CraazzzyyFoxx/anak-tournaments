// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import { useEntityWorkspace } from "@/hooks/useEntityWorkspace";
import { useWorkspaceStore } from "@/stores/workspace.store";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Owner({ workspaceId, discipline }: Readonly<{ workspaceId: number; discipline: string }>) {
  useEntityWorkspace(workspaceId, discipline);
  return null;
}

it("holds the opened owner's community and game while it is open, then clears both and leaves the scope alone", async () => {
  useWorkspaceStore.setState({ entityWorkspaceId: null, entityDiscipline: null, gameScope: "all" });
  const root = createRoot(document.body.appendChild(document.createElement("div")));

  await act(async () => root.render(<Owner workspaceId={7} discipline="lol" />));
  expect(useWorkspaceStore.getState()).toMatchObject({ entityWorkspaceId: 7, entityDiscipline: "lol", gameScope: "all" });

  await act(async () => root.render(<Owner workspaceId={7} discipline="overwatch" />));
  expect(useWorkspaceStore.getState()).toMatchObject({ entityWorkspaceId: 7, entityDiscipline: "overwatch" });

  await act(async () => root.unmount());
  expect(useWorkspaceStore.getState()).toMatchObject({ entityWorkspaceId: null, entityDiscipline: null, gameScope: "all" });
  expect(document.cookie).not.toContain("owt-discipline=");
});
