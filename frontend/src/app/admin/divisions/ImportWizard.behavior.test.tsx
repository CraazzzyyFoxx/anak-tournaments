import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DivisionGridImportWizard } from "./ImportWizard";

function renderWizard() {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <DivisionGridImportWizard workspaceId={9} canImport onImported={async () => undefined} />
    </QueryClientProvider>
  );
}

describe("DivisionGridImportWizard", () => {
  it("presents one compact version import form without a gallery workflow", () => {
    const html = renderWizard();

    expect(html).toContain("Import one version");
    expect(html).toContain("Source workspace");
    expect(html).toContain("Division grid");
    expect(html).toContain("Version");
    expect(html).toContain("OW rank mappings");
    expect(html).toContain("Copy tier icons");
    expect(html).toContain("Import version");
    expect(html).not.toContain("Import steps");
    expect(html).not.toContain("Review import");
    expect(html).not.toContain("workspace library");
  });
});
