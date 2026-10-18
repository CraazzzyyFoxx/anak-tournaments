// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { navigation } from "@/test/url-navigation";
import { useWorkspaceStore } from "@/stores/workspace.store";

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
  useWorkspaceStore.setState({ browsingDiscipline: "overwatch" });
});

describe("browsing links carry the surface's game", () => {
  it("a shared ?discipline=lol URL follows the nav to other browsing surfaces without touching the saved preference", async () => {
    const hrefs = await hrefsFrom("/tournaments?discipline=lol", "/achievements", "/tournaments", "/tournaments/spring-cup", "/privacy");

    expect(hrefs).toEqual([
      "/achievements?discipline=lol",
      "/tournaments?discipline=lol",
      "/tournaments/spring-cup",
      "/privacy"
    ]);
    expect(useWorkspaceStore.getState().browsingDiscipline).toBe("overwatch");
  });

  it("all goes to a directory and is omitted for a concrete destination", async () => {
    expect(await hrefsFrom("/tournaments?discipline=all", "/tournaments", "/achievements")).toEqual([
      "/tournaments?discipline=all",
      "/achievements"
    ]);
  });

  it("an owner page's links carry nothing", async () => {
    expect(await hrefsFrom("/tournaments/spring-cup?discipline=lol", "/achievements")).toEqual(["/achievements"]);
  });
});
