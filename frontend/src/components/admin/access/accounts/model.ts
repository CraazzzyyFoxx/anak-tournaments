import { accountEmail, accountTitle } from "@/components/admin/access/AccountCard";
import type { AuthAdminUser } from "@/types/rbac.types";

/** Under the inspector title: the login name, when the title is the player, and a real email. */
export function accountSubtitle(account: AuthAdminUser): string | undefined {
  const parts = [
    accountTitle(account) === account.username ? null : `@${account.username}`,
    accountEmail(account)
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}
