import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";

import type { RealtimeConnectionState } from "@/types/realtime.types";

import { ConnectionIndicator } from "./ConnectionIndicator";

const messages = {
  common: {
    connection: {
      idle: "Realtime idle",
      connecting: "Connecting",
      connected: "Live connection",
      reconnecting: "Reconnecting"
    }
  }
};

function render(connectionState: RealtimeConnectionState): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ConnectionIndicator connectionState={connectionState} />
    </NextIntlClientProvider>
  );
}

describe("ConnectionIndicator", () => {
  const cases: Array<[RealtimeConnectionState, string]> = [
    ["idle", "Realtime idle"],
    ["connecting", "Connecting"],
    ["connected", "Live connection"],
    ["reconnecting", "Reconnecting"]
  ];

  it.each(cases)("renders distinct, non-empty text for the %s state", (state, label) => {
    const html = render(state);
    expect(html).toContain(label);
  });

  it("exposes a polite status region so assistive tech announces a change", () => {
    const html = render("connecting");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });

  // Only "connected" reads as healthy; every other state (including the
  // initial "idle") shares the same warning color so a stalled connection
  // never looks indistinguishable from a healthy one.
  it("reserves the connected color for the connected state only", () => {
    expect(render("connected")).toContain("aqt-support");
    expect(render("idle")).toContain("aqt-warm");
    expect(render("connecting")).toContain("aqt-warm");
    expect(render("reconnecting")).toContain("aqt-warm");
  });

  it("hides the connected label so the LED is not a third control", () => {
    expect(render("connected")).toContain("sr-only");
    expect(render("reconnecting")).not.toContain("sr-only");
  });
});
