// @vitest-environment happy-dom
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import en from "@/i18n/messages/en.json";

import { UpdatingBadge } from "./UpdatingBadge";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** A tab the way every tournament view draws one: the badge only while a refresh is in flight. */
function Tab({ fetching }: Readonly<{ fetching: boolean }>) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <section>
        {fetching ? <UpdatingBadge /> : null}
        <p>content</p>
      </section>
    </NextIntlClientProvider>
  );
}

describe("UpdatingBadge", () => {
  it("hydrates a tab whose refresh started in the browser before it hydrated, then shows the badge", async () => {
    // The server never has a refresh in flight.
    const container = document.createElement("div");
    container.innerHTML = renderToString(<Tab fetching={false} />);
    document.body.appendChild(container);
    const mismatches: unknown[] = [];

    const root = await act(async () =>
      hydrateRoot(container, <Tab fetching />, {
        onRecoverableError: (error) => mismatches.push(error)
      })
    );

    expect(mismatches).toEqual([]);
    expect(container.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe(
      en.tournamentDetail.pageState.updating
    );
    act(() => root.unmount());
    container.remove();
  });
});
