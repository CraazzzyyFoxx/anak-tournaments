import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import PlayerRoleIcon from "./PlayerRoleIcon";
import { DEADLOCK_METADATA } from "@/test/discipline-metadata";
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

describe("role presentation in a one-role game", () => {
  it("draws the open slot but no glyph for the game's only role", () => {
    expect(renderToStaticMarkup(<PlayerRoleIcon role="agent" ontology={DEADLOCK_METADATA} />)).toBe("");
    expect(renderToStaticMarkup(<PlayerRoleIcon role={null} ontology={DEADLOCK_METADATA} />)).toContain("<svg");
  });
});
