"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";

import { SETTINGS_TABS, useAccountSettingsModalStore } from "@/stores/account-settings-modal.store";

const AccountSettingsDialog = dynamic(() => import("./account-settings/AccountSettingsDialog"), {
  ssr: false
});

/**
 * Always-mounted gate for the account settings dialog: it owns the
 * `?settings=` deep link and mounts the dialog (a lazy chunk) on the first
 * open, then keeps it mounted so the close animation still plays.
 */
const AccountSettingsModal = () => {
  const isOpen = useAccountSettingsModalStore((state) => state.isOpen);
  const open = useAccountSettingsModalStore((state) => state.open);
  const [hasOpened, setHasOpened] = useState(isOpen);
  if (isOpen && !hasOpened) setHasOpened(true);
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    // Auto-open modal if URL has ?settings=... parameter (e.g. returning from OAuth)
    const settingsTab = searchParams.get("settings");
    if (settingsTab === "api-keys") {
      router.replace("/admin/access/api-keys");
      return;
    }
    // Back-compat: the standalone "connections" tab was merged into the profile tab.
    // Keep stale bookmarks and in-flight OAuth `next` redirects working.
    const resolvedTab = settingsTab === "connections" ? "profile" : settingsTab;
    const matchedTab = SETTINGS_TABS.find((tab) => tab === resolvedTab);
    if (matchedTab) {
      open(matchedTab);

      // Clean up URL without reloading
      const url = new URL(window.location.href);
      url.searchParams.delete("settings");
      window.history.replaceState({}, "", url.toString());
    }
  }, [searchParams, open, router]);

  return hasOpened ? <AccountSettingsDialog /> : null;
};

export default AccountSettingsModal;
