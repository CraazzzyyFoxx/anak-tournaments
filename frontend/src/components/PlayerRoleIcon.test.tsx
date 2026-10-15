import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import PlayerRoleIcon from "./PlayerRoleIcon";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

describe("player role icons", () => {
  it("renders ontology codes, legacy display names and the unassigned Flex presentation", () => {
    for (const [role, name] of [["tank", "tank"], ["damage", "damage"], ["support", "support"], ["Tank", "tank"], [null, "flex"]]) {
      const html = renderToStaticMarkup(<PlayerRoleIcon role={role} />);
      expect(html).toContain("<svg");
      expect(html).toContain(`aria-label="common.roles.${name}"`);
    }
    expect(renderToStaticMarkup(<PlayerRoleIcon role="unknown" />)).toBe("");
    expect(renderToStaticMarkup(<PlayerRoleIcon role="support" decorative />)).toContain('aria-hidden="true"');
  });
});
