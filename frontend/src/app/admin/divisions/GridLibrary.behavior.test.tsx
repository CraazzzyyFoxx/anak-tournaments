import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DivisionGridEntity } from "@/types/workspace.types";

import { DivisionGridLibrary } from "./GridLibrary";

const grids: DivisionGridEntity[] = [
  {
    id: 1,
    workspace_id: 9,
    slug: "legacy",
    name: "Legacy Grid",
    description: null,
    source_workspace_id: null,
    source_grid_id: null,
    source_fingerprint: null,
    imported_at: null,
    archived_at: null,
    versions: [
      {
        id: 11,
        grid_id: 1,
        version: 1,
        label: "Legacy",
        status: "published",
        created_from_version_id: null,
        published_at: "2026-01-01T00:00:00Z",
        tiers: []
      }
    ]
  },
  {
    id: 2,
    workspace_id: 9,
    slug: "current",
    name: "Current Grid",
    description: null,
    source_workspace_id: 3,
    source_grid_id: 7,
    source_fingerprint: "a".repeat(64),
    imported_at: "2026-07-24T00:00:00Z",
    archived_at: null,
    versions: [
      {
        id: 22,
        grid_id: 2,
        version: 2,
        label: "Season 2",
        status: "published",
        created_from_version_id: null,
        published_at: "2026-07-24T00:00:00Z",
        tiers: []
      }
    ]
  }
];

function renderLibrary(permissions: {
  create: boolean;
  update: boolean;
  delete: boolean;
  import: boolean;
  export: boolean;
}) {
  const html = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <DivisionGridLibrary
        workspaceId={9}
        workspaceName="Test workspace"
        defaultVersionId={22}
        grids={grids}
        selectedGridId={2}
        permissions={permissions}
        loading={false}
        error={null}
        onSelect={() => undefined}
        onChanged={async () => undefined}
      />
    </QueryClientProvider>
  );
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document;
}

const deniedPermissions = {
  create: false,
  update: false,
  delete: false,
  import: false,
  export: false
};

describe("DivisionGridLibrary", () => {
  it("derives the active grid from the workspace default version instead of array order", () => {
    const document = renderLibrary(deniedPermissions);
    const activeCard = document.querySelector('[data-ui="card"]');

    expect(activeCard?.textContent).toContain("Current Grid");
    expect(activeCard?.textContent).toContain("Season 2");
    expect(activeCard?.textContent).not.toContain("Legacy Grid");
  });

  it("hides every mutating control when its operation permission is absent", () => {
    const document = renderLibrary(deniedPermissions);
    const buttonLabels = Array.from(document.querySelectorAll("button"), (button) =>
      button.textContent?.trim()
    );

    expect(buttonLabels).not.toContain("New grid");
    expect(buttonLabels).not.toContain("Import JSON");
    expect(buttonLabels).not.toContain("Rename");
    expect(buttonLabels).not.toContain("Export");
    expect(buttonLabels).not.toContain("Archive");
    expect(buttonLabels).toContain("Open");
  });

  it("shows only controls backed by explicitly granted permissions", () => {
    const document = renderLibrary({
      create: true,
      update: true,
      delete: false,
      import: false,
      export: true
    });
    const buttonLabels = Array.from(document.querySelectorAll("button"), (button) =>
      button.textContent?.trim()
    );

    expect(buttonLabels).toContain("New grid");
    expect(buttonLabels).toContain("Rename");
    expect(buttonLabels).toContain("Export");
    expect(buttonLabels).toContain("Archive");
    expect(buttonLabels).not.toContain("Import JSON");
  });
});
