import { SOCIAL_PROVIDER_ORDER, sortSocialAccounts } from "@/lib/social/providers";
import type { SocialAccount, SocialProvider } from "@/types/user.types";

/** Providers a user can OAuth-link, and thereby verify. */
export const OAUTH_ADDABLE: readonly SocialProvider[] = ["battlenet", "riot", "steam", "discord", "twitch"];

export interface LinkedProvider {
  provider: SocialProvider;
  accounts: SocialAccount[];
}

/**
 * The linked-accounts list: every provider the user has an account on, in
 * display order (unknown providers last), each with its accounts sorted; then
 * the OAuth providers they have none on yet, which can be connected.
 */
export function groupLinkedAccounts(
  accounts: readonly SocialAccount[],
  addable: readonly SocialProvider[]
): { connected: LinkedProvider[]; connectable: SocialProvider[] } {
  // Insertion order over the sorted list: known providers in display order,
  // then unknown ones in first-seen order (they share one rank, so a plain
  // run-length grouping could split an unknown provider in two).
  const byProvider = new Map<SocialProvider, SocialAccount[]>();
  for (const account of sortSocialAccounts(accounts)) {
    const list = byProvider.get(account.provider);
    if (list) list.push(account);
    else byProvider.set(account.provider, [account]);
  }
  return {
    connected: [...byProvider].map(([provider, list]) => ({ provider, accounts: list })),
    connectable: SOCIAL_PROVIDER_ORDER.filter((provider) => addable.includes(provider) && !byProvider.has(provider))
  };
}
