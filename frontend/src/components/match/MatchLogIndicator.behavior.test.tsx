// @vitest-environment happy-dom
// The log download is a browser-navigated `<a download>` against an
// authenticated gateway route, so a link shown to an anonymous visitor
// downloads a 401 JSON body named like a log file. The link must therefore
// appear only for a confirmed session — and must still appear for one, or the
// feature is simply gone. Both directions are pinned here.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import MatchLogIndicator from "@/components/match/MatchLogIndicator";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Labels come through as their message keys, so assertions read as the keys the
// component is contracted to use.
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

let authStatus = "anonymous";
vi.mock("@/hooks/useAuthProfile", () => ({ useAuthProfile: () => ({ status: authStatus }) }));

function render(status: string) {
  authStatus = status;
  const host = document.createElement("div");
  document.body.appendChild(host);
  act(() => {
    createRoot(host).render(
      <MatchLogIndicator hasLogs logs={[{ matchId: 7, label: "Ilios" }]} />
    );
  });
  return host;
}

describe("MatchLogIndicator", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("offers the download to a signed-in viewer", () => {
    const host = render("authenticated");

    const link = host.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/api/v1/matches/7/log");
    expect(link?.hasAttribute("download")).toBe(true);
  });

  it.each(["anonymous", "idle", "loading", "error"])(
    "withholds the link but keeps the availability signal when status is %s",
    (status) => {
      const host = render(status);

      expect(host.querySelector("a")).toBeNull();
      expect(host.querySelector("button")).toBeNull();
      // Still says logs exist — only the download is gone.
      expect(host.querySelector("[role='img']")?.getAttribute("aria-label")).toBe(
        "common.matchLogs.available"
      );
    }
  );
});
