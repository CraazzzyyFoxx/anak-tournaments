// @vitest-environment happy-dom
//
// The constructor's copy comes from the admin bundle. Splitting `pickBan` by subtree for the mix settings
// (`check-zone-boundaries` Z4) must leave it whole there, so the rules step mounts under the real admin projection,
// not the test setup's whole-English fallback.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import { pickMessages } from "@/i18n/zones";
import { emptyRuleset, type PickBanDraft } from "@/lib/tournament/pick-ban-config";

import { RulesStep } from "./RulesStep";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/services/pickBan.service", () => ({
  default: {
    getRulesCatalog: async () => ({
      leaves: [],
      constraints: [],
      groups: { hero: [], map: [] },
      presets: [
        {
          id: "hero_classic",
          kind: "hero",
          modes: ["pool"],
          first_ban_rotation: null,
          ruleset: { version: 2, timer_seconds: null, on_timeout: "random_fill", phases: [] },
          mix_eligible: true,
        },
      ],
    }),
    previewRuleset: async () => ({ maps: [], issues: [] }),
  },
}));

const DRAFT: PickBanDraft = {
  configId: null,
  kind: "hero",
  stageId: null,
  round: null,
  mode: "pool",
  firstBanRotation: "fixed",
  ruleset: emptyRuleset("hero"),
  itemIds: [],
  slots: [],
  roundSlots: [],
  inheritedFrom: null,
};

function tick() {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

it("reads the rules step and its preset names from the admin bundle", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(
      // A missing message renders its dotted key instead of the copy; the assertions read the copy.
      <NextIntlClientProvider locale="en" messages={pickMessages(en, "admin")} onError={() => undefined}>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <RulesStep
            tournamentId={1}
            discipline="overwatch"
            draft={DRAFT}
            kind="hero"
            series={{ bestOf: 3, source: "stage" }}
            issues={[]}
            validating={false}
            inherited={null}
            inheritedLabel={null}
            catalogue={[]}
            canManage
            patch={() => undefined}
          />
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
  for (let settled = 0; settled < 2; settled += 1) {
    await act(async () => {
      await tick();
    });
  }

  expect(container.textContent).toContain(en.pickBan.rules.title);
  const presets = container.querySelector(`[role="combobox"][aria-label="${en.pickBan.rules.presets}"]`);
  await act(async () => {
    presets?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    presets?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
  });
  expect([...document.querySelectorAll('[role="option"]')].map((node) => node.textContent?.trim())).toEqual([
    en.pickBan.rules.preset.hero_classic,
  ]);
});
