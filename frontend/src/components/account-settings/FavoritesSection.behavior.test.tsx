// @vitest-environment happy-dom
// The unfavorite star is nested inside the row it removes, and the two ways
// that can silently misbehave are cheap to make: rendering a stale list after
// the mutation (a removed player lingers until a manual refresh) and losing
// the row's link target (getPlayerSlug drifts from the actual profile route).
// Both are pinned here against the real component, the real
// useFavoritePlayers hook, and the real FavoriteStarButton — only meService,
// next-intl, and auth state are mocked.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import FavoritesSection from "@/components/account-settings/FavoritesSection";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getFavoritePlayers = vi.fn();
const removeFavoritePlayer = vi.fn();

vi.mock("@/services/me.service", () => ({
  default: {
    getFavoritePlayers: (...args: unknown[]) => getFavoritePlayers(...args),
    addFavoritePlayer: vi.fn(),
    removeFavoritePlayer: (...args: unknown[]) => removeFavoritePlayer(...args),
  },
}));

// Labels come through as their message keys, so the empty-state assertion
// reads as the key the component is contracted to use.
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

vi.mock("@/hooks/useAuthProfile", () => ({
  useAuthProfile: () => ({ status: "authenticated", user: { id: 5 }, error: null, refetch: () => {} }),
}));

vi.mock("@/stores/auth-modal.store", () => ({
  useAuthModalStore: (select: (state: unknown) => unknown) =>
    select({ isOpen: false, nextPath: "/", open: vi.fn(), close: vi.fn() }),
}));

// Plain anchor stand-in: next/link's app-router context is not mounted here.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

async function tick() {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  await act(async () => {
    await promise;
  });
}

async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <FavoritesSection />
      </QueryClientProvider>
    );
  });
  await tick();
  await tick();
  return container;
}

beforeEach(() => {
  document.body.innerHTML = "";
  getFavoritePlayers.mockReset();
  removeFavoritePlayer.mockReset();
  removeFavoritePlayer.mockResolvedValue(undefined);
});

describe("FavoritesSection", () => {
  it("renders the empty state when there are no favorites", async () => {
    getFavoritePlayers.mockResolvedValue([]);
    const container = await mount();

    expect(container.textContent).toContain("favorites.empty");
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("renders favorited players with links to their profile", async () => {
    getFavoritePlayers.mockResolvedValue([
      { id: 1, name: "CraazzzyyFox#2130" },
      { id: 2, name: "Someone#1111" },
    ]);
    const container = await mount();

    const links = Array.from(container.querySelectorAll<HTMLAnchorElement>("a"));
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toBe("/users/CraazzzyyFox-2130");
    expect(links[0].textContent).toBe("CraazzzyyFox#2130");
    expect(links[1].getAttribute("href")).toBe("/users/Someone-1111");
  });

  it("removes a player from the list when its star is clicked", async () => {
    getFavoritePlayers.mockResolvedValue([{ id: 1, name: "CraazzzyyFox#2130" }]);
    const container = await mount();
    expect(container.querySelectorAll("a")).toHaveLength(1);

    const star = container.querySelector<HTMLButtonElement>("button");
    expect(star, "unfavorite star button").toBeTruthy();

    // The mutation's onSuccess invalidates the shared query, which refetches
    // through the same mock — reflect the post-removal server state there.
    getFavoritePlayers.mockResolvedValue([]);

    await act(async () => {
      star!.click();
    });
    await tick();
    await tick();

    expect(removeFavoritePlayer).toHaveBeenCalledWith(1);
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.textContent).toContain("favorites.empty");
  });
});
