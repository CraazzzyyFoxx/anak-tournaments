import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import DraftRoomLoading from "./loading";

// Module mocks are process-wide in bun: every mock of next-intl in the draft
// suite exposes the same hooks, or whichever file loads first breaks the rest.
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => `draftRedesign.${key}`
}));

describe("draft room loading route", () => {
  it("holds the route on the room's skeleton while it loads", () => {
    const html = renderToStaticMarkup(<DraftRoomLoading />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('data-draft-skeleton="header"');
  });
});
