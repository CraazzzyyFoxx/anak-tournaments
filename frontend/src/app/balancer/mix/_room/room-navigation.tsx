"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps, MouseEvent, MouseEventHandler } from "react";

import { lobbyIndexFromLetter } from "@/app/balancer/mix/pickup-chrome";

import "./room-transitions.css";

/** Into a lobby's room from the mix page, or back out to it. */
export type RoomNavigation = "enter" | "leave";

/** The name the lobby wears on both pages: its card (or its desk) on the mix page, the room's frame in the room. */
const LOBBY_TRANSITION_NAME = "mix-lobby";

/**
 * How long the old page may stay frozen while the next one loads. Past it the transition plays on what is there and
 * the page lands without the morph; the browser's own cap is 4s.
 */
const LANDING_TIMEOUT_MS = 1000;

let navigating = false;

/** A navigation between the mix page and a room is animating: the room's own transitions sit it out. */
export function roomNavigationActive(): boolean {
  return navigating;
}

/** The lobby on the mix page: its desk while that is open, else its card (one of the two carries the attribute). */
function mixLobbyElement(lobbyIndex: number | null): HTMLElement | null {
  return lobbyIndex == null ? null : document.querySelector<HTMLElement>(`[data-mix-lobby="${lobbyIndex}"]`);
}

function roomElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-mix-room]");
}

/**
 * Runs `navigate` (the router call) inside a view transition: entering, the lobby's card or desk grows into its room;
 * leaving, the room shrinks back into it; a player on the desk and in the room flies between the two; the rest of the
 * pages crossfade. The new state is captured once the room has appeared (or gone). Without the API, or under reduced
 * motion, it just navigates.
 */
export function navigateRoom(direction: RoomNavigation, lobbyIndex: number | null, navigate: () => void): void {
  if (
    typeof document.startViewTransition !== "function" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    navigate();
    return;
  }
  const named: HTMLElement[] = [];
  const wearName = (element: HTMLElement | null) => {
    if (element == null) return;
    element.style.viewTransitionName = LOBBY_TRANSITION_NAME;
    named.push(element);
  };
  const root = document.documentElement;
  wearName(direction === "enter" ? mixLobbyElement(lobbyIndex) : roomElement());
  root.dataset.mixNav = direction;
  navigating = true;

  const transition = document.startViewTransition(
    () =>
      new Promise<void>((resolve) => {
        let done = false;
        const landed = () => (roomElement() != null) === (direction === "enter");
        const land = () => {
          if (done) return;
          done = true;
          observer.disconnect();
          window.clearTimeout(timer);
          // The old page is gone once it landed, so the new one may wear the name without a duplicate.
          if (landed()) wearName(direction === "enter" ? roomElement() : mixLobbyElement(lobbyIndex));
          resolve();
        };
        const observer = new MutationObserver(() => {
          if (landed()) land();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        const timer = window.setTimeout(land, LANDING_TIMEOUT_MS);
        navigate();
      })
  );
  void transition.finished.finally(() => {
    for (const element of named) element.style.viewTransitionName = "";
    delete root.dataset.mixNav;
    navigating = false;
  });
}

/** A plain left click on a link between the mix page and a room navigates inside the transition; any other passes. */
export function useRoomLinkClick(
  direction: RoomNavigation,
  lobbyIndex: number | null,
  href: string
): MouseEventHandler<HTMLAnchorElement> {
  const router = useRouter();
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    navigateRoom(direction, lobbyIndex, () => router.push(href));
  };
}

/** A link into a lobby's room (`mixRoomHref`): its lobby is the route's letter. */
export function RoomLink({ href, ...props }: Omit<ComponentProps<typeof Link>, "href" | "onClick"> & { href: string }) {
  const onClick = useRoomLinkClick("enter", lobbyIndexFromLetter(href.slice(href.lastIndexOf("/") + 1)), href);
  return <Link href={href} {...props} onClick={onClick} />;
}
