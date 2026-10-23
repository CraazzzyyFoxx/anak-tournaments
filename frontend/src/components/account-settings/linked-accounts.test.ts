import { describe, expect, it } from "vitest";

import type { SocialAccount, SocialProvider } from "@/types/user.types";

import { OAUTH_ADDABLE, groupLinkedAccounts } from "./linked-accounts";

const account = (id: number, provider: string, extra: Partial<SocialAccount> = {}): SocialAccount => ({
  id,
  user_id: 1,
  provider: provider as SocialProvider,
  username: `${provider}-${id}`,
  url: null,
  is_verified: true,
  is_primary: false,
  ...extra
});

describe("groupLinkedAccounts", () => {
  it("lists connected providers in display order, unknown ones last, each with its accounts sorted", () => {
    const { connected } = groupLinkedAccounts(
      [
        account(1, "steam"),
        account(2, "mystery"),
        account(3, "battlenet"),
        account(4, "discord"),
        account(5, "battlenet", { is_primary: true })
      ],
      OAUTH_ADDABLE
    );

    expect(connected.map((group) => group.provider)).toEqual(["battlenet", "discord", "steam", "mystery"]);
    // Primary first, then by id.
    expect(connected[0].accounts.map((a) => a.id)).toEqual([5, 3]);
  });

  it("offers only the OAuth providers with no account, in display order", () => {
    expect(groupLinkedAccounts([], OAUTH_ADDABLE).connectable).toEqual([
      "battlenet",
      "discord",
      "twitch",
      "riot",
      "steam"
    ]);

    const { connected, connectable } = groupLinkedAccounts(
      [account(1, "discord"), account(2, "steam", { is_verified: false })],
      OAUTH_ADDABLE
    );
    expect(connectable).toEqual(["battlenet", "twitch", "riot"]);
    for (const group of connected) expect(connectable).not.toContain(group.provider);
  });

  it("shows a non-OAuth provider when present and never offers it", () => {
    const { connected, connectable } = groupLinkedAccounts([account(1, "boosty")], OAUTH_ADDABLE);

    expect(connected.map((group) => group.provider)).toEqual(["boosty"]);
    expect(connectable).not.toContain("boosty");
    expect(groupLinkedAccounts([], OAUTH_ADDABLE).connectable).not.toContain("boosty");
  });
});
