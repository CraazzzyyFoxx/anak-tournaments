// @vitest-environment happy-dom
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import en from "@/i18n/messages/en.json";
import { OW_METADATA } from "@/test/discipline-metadata";

import LobbyRankTiles from "./LobbyRankTiles";

function render(stats: Record<string, { value: number; rank: number; total: number }>) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en}>
      <LobbyRankTiles stats={stats} onOpen={() => {}} metadata={OW_METADATA} />
    </NextIntlClientProvider>
  );
}

describe("Overwatch lobby-rank tiles (moved out of the core profile card)", () => {
  it("keeps Overwatch's order, labels and compact values; unranked stats are not drawn", () => {
    const html = render({
      eliminations: { value: 1234.5, rank: 3, total: 40 },
      kda: { value: 2.5, rank: 1, total: 40 },
      deaths: { value: 4, rank: Number.NaN, total: 40 }
    });
    const kda = html.indexOf(en.users.overview.lastTournament.stat.kda);
    const elims = html.indexOf(en.users.overview.lastTournament.stat.elims);
    expect(kda).toBeGreaterThan(-1);
    expect(elims).toBeGreaterThan(kda);
    expect(html).toContain("2.50");
    expect(html).toContain("1.2k");
    expect(html).not.toContain(en.users.overview.lastTournament.stat.deaths);
  });

  it("signs a damage lead and tints it good, a deficit bad", () => {
    const lead = render({ damage_delta: { value: 512, rank: 2, total: 10 } });
    expect(lead).toContain("+512.00");
    expect(lead).toContain("var(--aqt-emerald)");
    const deficit = render({ damage_delta: { value: -80, rank: 9, total: 10 } });
    expect(deficit).toContain("-80.00");
    expect(deficit).toContain("var(--aqt-rose)");
  });
});
