import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import PlayerRoleIcon from "./PlayerRoleIcon";
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

describe("role presentation without a dictionary", () => {
  it("keeps an unassigned/open slot distinct from unknown historical references", () => {
    expect(renderToStaticMarkup(<PlayerRoleIcon role={null} />)).toContain("<svg");
    const unknown = renderToStaticMarkup(<PlayerRoleIcon role={{ dimension: "position", role: "missing" }} />);
    expect(unknown).toContain("common.roleOntology.unknown");
    expect(unknown).not.toContain("<svg");
    expect(unknown).toContain("?");
    expect(renderToStaticMarkup(<PlayerRoleIcon role="support" decorative />)).toContain('aria-hidden="true"');
  });
});
