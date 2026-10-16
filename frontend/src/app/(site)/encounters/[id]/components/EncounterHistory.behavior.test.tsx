// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Match } from "@/types/encounter.types";
import EncounterHistory from "./EncounterHistory";

vi.mock("@/hooks/useAuthProfile", () => ({ useAuthProfile: () => ({ status: "authenticated" }) }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: { root: Root; host: HTMLElement }[] = [];

function observation(id: number, overrides: Partial<Match> = {}): Match {
  return {
    id,
    created_at: new Date("2024-06-08T18:30:00Z"),
    updated_at: null,
    home_team_id: 1,
    away_team_id: 2,
    home_participation: { id: 11, slot: 1, team_id: 1, name: "A", seed: null, score: 0, placement: null, active: false },
    away_participation: { id: 12, slot: 2, team_id: 2, name: "B", seed: null, score: 0, placement: null, active: false },
    score: { home: 2, away: 1 },
    time: 612,
    encounter_id: 6662,
    map_id: 21,
    map_index: null,
    log_name: "logs/old-round.txt",
    raw_status: "missing",
    raw_available: false,
    map: { id: 21, name: "Ilios", image_path: "/ilios.jpg" } as Match["map"],
    home_team: null,
    away_team: null,
    encounter: null,
    ...overrides
  };
}

function render(matches: Match[]) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push({ root, host });
  act(() => root.render(<EncounterHistory matches={matches} />));
  return host;
}

afterEach(() => {
  act(() => {
    for (const { root, host } of roots.splice(0)) {
      root.unmount();
      host.remove();
    }
  });
});

describe("EncounterHistory", () => {
  it("keeps every same-map unbound observation individually navigable without numbering official games", () => {
    const host = render([
      observation(7001),
      observation(7002, { raw_status: "conflict" }),
      observation(7003, { raw_status: "unverified" }),
      observation(7004, { map_index: 1, raw_status: "available", raw_available: true })
    ]);
    expect(host.querySelector("ol")).toBeNull();
    expect(host.querySelectorAll("ul > li")).toHaveLength(3);
    expect([...host.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual([
      "/matches/7001", "/matches/7002", "/matches/7003"
    ]);
    expect(host.textContent).toContain("Game binding is unconfirmed");
    expect(host.textContent).toContain("ordinary statistics");
    expect(host.textContent).toContain("Raw log file is missing");
    expect(host.textContent).toContain("recorded hash");
    expect(host.textContent).toContain("not been verified");
    expect(host.querySelector("[download]")).toBeNull();
    expect(host.querySelector("[role='status'], [aria-live]")).toBeNull();
  });

  it("uses the server raw capability even when the display filename is absent", () => {
    const host = render([observation(7001, {
      log_name: null,
      raw_status: "available",
      raw_available: true
    })]);
    const download = host.querySelector("a[download]");
    expect(download?.getAttribute("href")).toBe("/api/v1/matches/7001/log");
    expect(host.querySelector('a[href="/matches/7001"]')?.textContent).toContain("#7001");
    expect(host.textContent).toContain("Raw log verified");
  });

  it("does not repeat bound rows in history", () => {
    const host = render([observation(7001, { map_index: 2 })]);
    expect(host.querySelector("section")).toBeNull();
  });
});
