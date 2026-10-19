// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { navigation } from "@/test/url-navigation";

import { HoverPrefetchLink } from "./HoverPrefetchLink";

vi.mock("next/navigation", async () => (await import("@/test/url-navigation")).nextNavigationMock);
vi.mock("next/link", () => ({
  default: ({ prefetch: _prefetch, ...rest }: ComponentProps<"a"> & { prefetch?: boolean | null }) => <a {...rest} />
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function hrefsFrom(url: string, ...targets: string[]) {
  navigation.reset(url);
  const container = document.body.appendChild(document.createElement("div"));
  await act(async () =>
    createRoot(container).render(
      <>
        {targets.map((href) => (
          <HoverPrefetchLink key={href} href={href}>
            {href}
          </HoverPrefetchLink>
        ))}
      </>
    )
  );
  return [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("browsing links", () => {
  it("keep their plain hrefs: a game in the URL narrows only the page it is on", async () => {
    expect(await hrefsFrom("/tournaments?discipline=lol", "/achievements", "/tournaments/spring-cup", "/privacy")).toEqual([
      "/achievements",
      "/tournaments/spring-cup",
      "/privacy"
    ]);
    expect(await hrefsFrom("/tournaments?discipline=all", "/tournaments")).toEqual(["/tournaments"]);
  });
});
