// @vitest-environment happy-dom
import { createElement } from "react";
import { prerender } from "react-dom/static";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { expect, it, vi } from "vitest";

import messages from "@/i18n/messages/en.json";
import type { Workspace } from "@/types/workspace.types";
import { CommunityStats } from "./CommunityStats";

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({ locale: "en", messages, namespace: namespace as never })
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));
vi.mock("@/services/statistics.service", () => ({
  default: {
    getTournaments: async () => Promise.reject(new Error("down")),
    getTournamentsDivision: async () => Promise.reject(new Error("down")),
    getCharacterPlaytime: async () => Promise.reject(new Error("down"))
  }
}));
vi.mock("@/services/discipline.service", () => ({
  default: { metadata: async () => Promise.reject(new Error("down")) }
}));

it("keeps the block's game tabs when every statistics read fails", async () => {
  // The section's shell is an async server component: prerender waits for it as the RSC render would.
  const { prelude } = await prerender(
    createElement(
      NextIntlClientProvider,
      { locale: "en", messages, timeZone: "UTC" },
      await CommunityStats({ workspace: { id: 5 } as Workspace, discipline: "overwatch", tabs: "[block tabs]" })
    )
  );
  const root = document.createElement("div");
  root.innerHTML = await new Response(prelude).text();

  expect(root.querySelector('[role="status"]')).not.toBeNull();
  expect(root.textContent).toContain("[block tabs]");
});
