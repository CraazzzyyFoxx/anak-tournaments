import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { useSubTabSegment } from "./sub-tabs";

let pathname = "";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
// Only the segment hook is under test; keep the permission store out of the graph.
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({}) }));

const BASE = "/admin/tournaments/7/teams";
const TABS = ["roster", "draft"] as const;

function Probe() {
  const { segment, active, isKnown } = useSubTabSegment(BASE, TABS, "roster");
  return <output>{`${segment}|${active}|${isKnown}`}</output>;
}

function read(path: string): string {
  pathname = path;
  return renderToString(<Probe />).replace(/<\/?output>/g, "");
}

describe("useSubTabSegment", () => {
  it("reads the first segment after the base path, ignoring deeper ones", () => {
    expect(read(`${BASE}/draft`)).toBe("draft|draft|true");
    expect(read(`${BASE}/draft/round/2`)).toBe("draft|draft|true");
  });

  it("falls back on the bare base path, with or without a trailing slash", () => {
    expect(read(BASE)).toBe("roster|roster|true");
    expect(read(`${BASE}/`)).toBe("roster|roster|true");
  });

  it("keeps an unknown segment raw but resolves it to the fallback", () => {
    expect(read(`${BASE}/logs`)).toBe("logs|roster|false");
  });

  it("falls back when the path is outside the base", () => {
    expect(read("/admin/tournaments/7/matches/rooms")).toBe("roster|roster|true");
  });
});
