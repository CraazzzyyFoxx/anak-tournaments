// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { navigation } from "@/test/url-navigation";

import { Footer } from "./Footer";

vi.mock("next/navigation", async () => (await import("@/test/url-navigation")).nextNavigationMock);
vi.mock("next/link", () => ({
  default: ({ prefetch: _prefetch, ...rest }: ComponentProps<"a"> & { prefetch?: boolean | null }) => <a {...rest} />
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/hooks/useAuthProfile", () => ({ useAuthProfile: () => ({ user: null }) }));
vi.mock("@/components/CookieSettingsButton", () => ({ default: () => null }));
vi.mock("@/components/workspace/WorkspaceAvatar", () => ({ WorkspaceAvatar: () => null }));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("footer links", () => {
  it("carry the surface's game to browsing destinations only", async () => {
    navigation.reset("/tournaments?discipline=lol");
    const container = document.body.appendChild(document.createElement("div"));
    await act(async () => createRoot(container).render(<Footer tenant={null} />));
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));

    expect(hrefs).toContain("/achievements?discipline=lol");
    expect(hrefs).toContain("/tournaments?discipline=lol");
    expect(hrefs).toContain("/privacy");
    expect(hrefs).toContain("/docs");
  });
});
