// @vitest-environment happy-dom
// This button is nested inside clickable rows (search CommandItems, the
// profile toolbar) and gates its action on auth state, so the two ways it can
// silently misbehave are cheap to make: forgetting stopPropagation (which
// fires the row's own onSelect/onClick alongside the star) and calling the
// favorites API for an anonymous visitor instead of prompting login. Both are
// pinned here against the real component and the real useFavoritePlayers hook
// (only meService is mocked), so the add/remove branch selection is exercised
// end to end too.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import FavoriteStarButton from "@/components/FavoriteStarButton";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getFavoritePlayers = vi.fn();
const addFavoritePlayer = vi.fn();
const removeFavoritePlayer = vi.fn();
const openAuthModal = vi.fn();

let currentUser: { id: number } | null = null;

vi.mock("@/services/me.service", () => ({
  default: {
    getFavoritePlayers: (...args: unknown[]) => getFavoritePlayers(...args),
    addFavoritePlayer: (...args: unknown[]) => addFavoritePlayer(...args),
    removeFavoritePlayer: (...args: unknown[]) => removeFavoritePlayer(...args),
  },
}));

// Labels come through as their message keys, so the aria-label assertions (if
// any were added) would read as the keys the component is contracted to use.
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

vi.mock("@/hooks/useAuthProfile", () => ({
  useAuthProfile: () => ({
    status: currentUser ? "authenticated" : "anonymous",
    user: currentUser,
    error: null,
    refetch: () => {},
  }),
}));

vi.mock("@/stores/auth-modal.store", () => ({
  useAuthModalStore: (select: (state: unknown) => unknown) =>
    select({ isOpen: false, nextPath: "/", open: openAuthModal, close: vi.fn() }),
}));

async function tick() {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  await act(async () => {
    await promise;
  });
}

async function mount(playerId = 42) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const parentClick = vi.fn();
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <div onClick={parentClick}>
          <FavoriteStarButton playerId={playerId} />
        </div>
      </QueryClientProvider>
    );
  });
  await tick();
  await tick();
  return { container, parentClick };
}

function starButton(container: HTMLElement): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>("button");
  expect(found, "favorite star button").toBeTruthy();
  return found!;
}

beforeEach(() => {
  document.body.innerHTML = "";
  currentUser = null;
  getFavoritePlayers.mockReset();
  addFavoritePlayer.mockReset();
  removeFavoritePlayer.mockReset();
  openAuthModal.mockReset();
  getFavoritePlayers.mockResolvedValue([]);
  addFavoritePlayer.mockResolvedValue(undefined);
  removeFavoritePlayer.mockResolvedValue(undefined);
});

describe("FavoriteStarButton", () => {
  it("opens the auth modal for an anonymous visitor and never calls the favorites API", async () => {
    const { container, parentClick } = await mount(42);
    const button = starButton(container);

    await act(async () => {
      button.click();
    });

    expect(openAuthModal).toHaveBeenCalledTimes(1);
    expect(addFavoritePlayer).not.toHaveBeenCalled();
    expect(removeFavoritePlayer).not.toHaveBeenCalled();
    expect(parentClick).not.toHaveBeenCalled();
  });

  it("adds the player when authenticated and not yet favorited", async () => {
    currentUser = { id: 5 };
    getFavoritePlayers.mockResolvedValue([]);
    const { container } = await mount(42);
    await tick();
    const button = starButton(container);

    await act(async () => {
      button.click();
    });
    await tick();

    expect(addFavoritePlayer).toHaveBeenCalledWith(42);
    expect(removeFavoritePlayer).not.toHaveBeenCalled();
    expect(openAuthModal).not.toHaveBeenCalled();
  });

  it("removes the player when authenticated and already favorited", async () => {
    currentUser = { id: 5 };
    getFavoritePlayers.mockResolvedValue([{ id: 42, name: "Someone" }]);
    const { container } = await mount(42);
    await tick();
    const button = starButton(container);

    await act(async () => {
      button.click();
    });
    await tick();

    expect(removeFavoritePlayer).toHaveBeenCalledWith(42);
    expect(addFavoritePlayer).not.toHaveBeenCalled();
  });

  it("never bubbles the click to a parent handler, even when authenticated", async () => {
    currentUser = { id: 5 };
    getFavoritePlayers.mockResolvedValue([]);
    const { container, parentClick } = await mount(42);
    await tick();
    const button = starButton(container);

    await act(async () => {
      button.click();
    });

    expect(parentClick).not.toHaveBeenCalled();
  });
});
