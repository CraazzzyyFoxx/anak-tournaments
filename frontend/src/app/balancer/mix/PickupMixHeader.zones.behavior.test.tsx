// @vitest-environment happy-dom
//
// The header's hero-ban label and select read their copy from the zone bundle their page mounts, and the tools bundle
// ships only `pickBan.mixBans` and `pickBan.rules.preset` of the pick-ban namespace (`check-zone-boundaries` Z4). So
// these mount under the real projections, not the test setup's whole-English fallback.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import { pickMessages } from "@/i18n/zones";
import type { CustomGame } from "@/services/custom-game.service";

import { PickupMixHeader } from "./PickupMixHeader";

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
  },
}));

const GAME = {
  id: 12,
  workspace_id: 7,
  discipline: "overwatch",
  host_user_id: 9,
  co_hosts: [],
  host_display_name: "Host",
  name: "Thursday scrim",
  status: "balanced",
  created_at: "2026-01-01T00:00:00Z",
  lobby_count: 1,
  lobbies: [],
  matches_count: 0,
  last_match_at: null,
  self_signup: "closed",
  self_role_edit: false,
  hero_ban_preset: null,
  settings: { points_per_win: 0, team_names: {}, workspace_discord_channel_id: null },
} as unknown as CustomGame;

function tick() {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

async function mount(messages: Record<string, unknown>, canWrite: boolean, heroBanPreset: string | null) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(
      // A missing message renders its dotted key instead of the copy; the assertions read the copy.
      <NextIntlClientProvider locale="en" messages={messages} onError={() => undefined}>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <PickupMixHeader
            canWrite={canWrite}
            game={{ ...GAME, hero_ban_preset: heroBanPreset }}
            gameLoading={false}
            onOpenPool={() => undefined}
            showsRoles
            onOpenAccess={() => undefined}
            onSetBanPreset={() => undefined}
          />
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
  await act(async () => {
    await tick();
  });
  return container;
}

describe.each(["tools", "web"] as const)("the mix header's hero bans under the %s bundle", (zone) => {
  const messages = pickMessages(en, zone);

  it("names the mix's preset to a viewer", async () => {
    const scope = await mount(messages, false, "hero_classic");

    expect(scope.textContent).toContain(en.pickBan.mixBans.label);
    expect(scope.textContent).toContain(en.pickBan.rules.preset.hero_classic);
  });

  it("says a mix without one plays no bans", async () => {
    expect((await mount(messages, false, null)).textContent).toContain(en.pickBan.mixBans.none);
  });

  it("gives a host the select, labelled and on the preset's name", async () => {
    const scope = await mount(messages, true, "hero_classic");
    const select = scope.querySelector(`[role="combobox"][aria-label="${en.pickBan.mixBans.label}"]`);

    expect(select?.textContent?.trim()).toBe(en.pickBan.rules.preset.hero_classic);
  });
});

it("reads keys, not copy, from a bundle without the projection: the cases above are the bundle's doing", async () => {
  const { pickBan: _projected, ...withoutPickBan } = pickMessages(en, "tools");
  const scope = await mount(withoutPickBan, false, "hero_classic");

  expect(scope.textContent).not.toContain(en.pickBan.mixBans.label);
  expect(scope.textContent).not.toContain(en.pickBan.rules.preset.hero_classic);
});
