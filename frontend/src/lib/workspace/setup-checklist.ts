import type { Workspace } from "@/types/workspace.types";

/**
 * What a freshly created workspace still lacks, as one list.
 *
 * Read in two places that must not disagree: the last step of
 * `/admin/workspaces/new` ("here is what you set up, here is what is left")
 * and the overview of `/admin/settings` (the same list, for the organiser who
 * comes back a week later). Every item is a fact off the record, never a
 * guess: the timezone is NOT NULL with a default, so "timezone set" would
 * always be true and is deliberately not an item.
 */
const SETUP_ITEM_KEYS = [
  "icon",
  "profile",
  "links",
  "discord",
  "branding",
  "subdomain",
  "customDomain",
  "verification"
] as const;

type SetupItemKey = (typeof SETUP_ITEM_KEYS)[number];

/** The settings section the item is fixed in, as a path segment under the
 * shell's base path (`/admin/settings` or `/admin/workspaces/8`). `null` for
 * the one item the organiser cannot act on: platform verification is set by
 * a superuser. */
type SetupSection = "general" | "branding" | "domain" | "discord" | null;

export interface SetupItem {
  key: SetupItemKey;
  done: boolean;
  section: SetupSection;
  /** The `SettingGroup` id inside `section` that holds the fix, for a `#` link. */
  group: string | null;
}

const SECTION_OF: Record<SetupItemKey, SetupSection> = {
  icon: "general",
  profile: "general",
  links: "general",
  discord: "discord",
  branding: "branding",
  subdomain: "domain",
  customDomain: "domain",
  verification: null
};

const GROUP_OF: Record<SetupItemKey, string | null> = {
  icon: "identity",
  profile: "community",
  links: "links",
  discord: "server",
  branding: "palette",
  subdomain: "address",
  customDomain: "custom-domain",
  verification: null
};

function isDone(key: SetupItemKey, ws: Workspace): boolean {
  switch (key) {
    case "icon":
      return Boolean(ws.icon_url);
    case "profile":
      return Boolean(ws.tagline || ws.description || ws.about);
    case "links":
      return Boolean(ws.discord_url || ws.twitch_url || ws.boosty_url);
    case "discord":
      return Boolean(ws.discord_guild_id);
    case "branding":
      return ws.branding_enabled;
    case "subdomain":
      return Boolean(ws.subdomain);
    case "customDomain":
      return Boolean(ws.custom_domain_verified_at);
    case "verification":
      return ws.verification_status !== "unverified";
  }
}

export function workspaceSetupChecklist(ws: Workspace): SetupItem[] {
  return SETUP_ITEM_KEYS.map((key) => ({
    key,
    done: isDone(key, ws),
    section: SECTION_OF[key],
    group: GROUP_OF[key]
  }));
}
