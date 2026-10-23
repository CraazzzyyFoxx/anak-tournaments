type NavigationClick = Pick<
  MouseEvent,
  "defaultPrevented" | "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
>;

export function shouldIgnoreNavigationClick(event: NavigationClick): boolean {
  return (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

export function getInternalNavigationTarget(
  rawHref: string | null | undefined,
  currentOrigin: string
): string | null {
  if (!rawHref) {
    return null;
  }

  if (
    rawHref.startsWith("mailto:") ||
    rawHref.startsWith("tel:") ||
    rawHref.startsWith("javascript:")
  ) {
    return null;
  }

  try {
    const url = new URL(rawHref, currentOrigin);
    if (url.origin !== currentOrigin) {
      return null;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/**
 * Whether following `nextHref` from `currentHref` leaves the current document.
 *
 * `nextHref` resolves against the current URL, not the origin, so `#group`
 * means this page's group rather than the site root's. A fragment-only change
 * scrolls and unmounts nothing, so it is not a navigation the unsaved guard has
 * to stop: the settings outline links to its groups that way.
 */
export function isChangedInternalNavigation(
  currentHref: string,
  nextHref: string | null | undefined,
  currentOrigin: string
): boolean {
  if (!getInternalNavigationTarget(currentHref, currentOrigin) || !nextHref) return false;
  try {
    const current = new URL(currentHref, currentOrigin);
    const next = new URL(nextHref, current);
    if (next.origin !== currentOrigin) return false;
    return `${current.pathname}${current.search}` !== `${next.pathname}${next.search}`;
  } catch {
    return false;
  }
}
