// @vitest-environment happy-dom
//
// The host's formation switch: the team formation (balancer or captain draft) and, in draft mode, the pick clock.
// That a changed clock is kept is proven where it is kept: the account settings' save-and-reload case.
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import en from "@/i18n/messages/en.json";

import { MixFormationControl } from "./MixFormationControl";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function mount(value: { team_formation: "balance" | "draft"; draft_pick_seconds: number }) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={en}>
        <MixFormationControl value={value} onChange={() => undefined} idPrefix="t" />
      </NextIntlClientProvider>,
    );
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("MixFormationControl", () => {
  it("shows the pick clock only in draft mode", async () => {
    await mount({ team_formation: "balance", draft_pick_seconds: 30 });
    expect(container.querySelector('input[id="t-pick-seconds"]')).toBeNull();

    await mount({ team_formation: "draft", draft_pick_seconds: 30 });
    expect(container.querySelector<HTMLInputElement>('input[id="t-pick-seconds"]')?.value).toBe("30");
  });

  it("names the current formation on its trigger", async () => {
    await mount({ team_formation: "draft", draft_pick_seconds: 30 });
    const trigger = container.querySelector('[aria-label="' + en.mixes.header.formation + '"]');
    expect(trigger?.textContent).toContain(en.mixes.header.formationDraft);
  });
});
