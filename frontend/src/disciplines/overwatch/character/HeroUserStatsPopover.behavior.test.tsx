// @vitest-environment happy-dom
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import en from "@/i18n/messages/en.json";
import { catalogEntity } from "@/test/catalog";
import { OW_METADATA } from "@/test/discipline-metadata";
import type { CharacterSummary, UserMapCharacterStats } from "@/types/user.types";

import HeroMapPopover, { HeroStatsPopover } from "./HeroUserStatsPopover";

const render = (node: ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>
  );

const mercy = catalogEntity({ id: 1, name: "Mercy", attrs: { class: "support" } });

const hero = (games: number, win: number): CharacterSummary => ({
  character: mercy,
  stats: [
    { name: "hero_time_played", overall: 3600, avg_10: 0, avg_10_all: 0 },
    { name: "healing_dealt", overall: 0, avg_10: 9000, avg_10_all: 8000 },
    { name: "hero_damage_dealt", overall: 0, avg_10: 1500, avg_10_all: 1200 },
    { name: "final_blows", overall: 0, avg_10: 2, avg_10_all: 3 },
    { name: "kda", overall: 0, avg_10: 3, avg_10_all: 2.5 }
  ],
  games,
  win,
  loss: games - win,
  draw: 0,
  win_rate_all: 0.5,
  record: { stat: "healing_dealt", value: 18432, encounter_id: 9, map_name: "Rialto", tournament_name: "OWAL Season 5" }
});

const onMap = (games: number, win: number): UserMapCharacterStats => ({
  character: mercy,
  games,
  win,
  loss: games - win,
  draw: 0,
  win_rate: win / games,
  playtime_seconds: 600,
  playtime_share_on_map: 0.4
});

describe("Overwatch hero cards", () => {
  it("compares the class's own figures, healing first for a support, against every player on the hero", () => {
    const html = render(<HeroStatsPopover hero={hero(20, 12)} metadata={OW_METADATA} />);
    const heal = html.indexOf(en.users.heroes.quick.heal10);
    expect(heal).toBeGreaterThan(-1);
    expect(heal).toBeLessThan(html.indexOf(en.users.heroes.quick.dmg10));
    expect(html).not.toContain(en.users.heroes.quick.finalBlows10);
    expect(html).toContain("+10% vs avg");
    expect(html).toContain("Rialto");
  });

  it("hides every comparison below the sample floor and greys the winrate", () => {
    const html = render(<HeroStatsPopover hero={hero(3, 3)} metadata={OW_METADATA} />);
    expect(html).toContain("100%");
    expect(html).toContain("color:var(--aqt-fg-faint)");
    expect(html).not.toContain("vs avg");
    expect(html).not.toContain("Average on this hero");
  });

  it("on a map, shows the gap to the player's map winrate only with a sample", () => {
    const sampled = render(
      <HeroMapPopover entity={mercy} mapStats={onMap(10, 7)} mapCharacters={[onMap(10, 7)]} mapWinRate={0.5} metadata={OW_METADATA} />
    );
    expect(sampled).toContain(en.common.heroStats.vsMap);
    expect(sampled).toContain("+20%");

    const thin = render(
      <HeroMapPopover entity={mercy} mapStats={onMap(1, 1)} mapCharacters={[onMap(1, 1)]} mapWinRate={0.5} metadata={OW_METADATA} />
    );
    expect(thin).not.toContain(en.common.heroStats.vsMap);
  });
});
