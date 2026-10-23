import { create } from "zustand";

export const SETTINGS_TABS = ["profile", "privacy", "security", "notifications", "favorites", "mixes", "logs"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

type AccountSettingsModalStore = {
  isOpen: boolean;
  activeTab: SettingsTab;
  /**
   * Below `md` the dialog shows either its section list or one section;
   * `false` is the list. Wider screens show both and ignore it.
   */
  sectionOpen: boolean;
  /** With a tab, opens straight on it; without one, a phone starts on the list (a wider screen on Profile). */
  open: (tab?: SettingsTab) => void;
  close: () => void;
  setActiveTab: (tab: SettingsTab) => void;
  /** Back from a section to the list (phones). */
  showSections: () => void;
};

export const useAccountSettingsModalStore = create<AccountSettingsModalStore>((set) => ({
  isOpen: false,
  activeTab: "profile",
  sectionOpen: false,
  open: (tab) => set({ isOpen: true, activeTab: tab ?? "profile", sectionOpen: tab !== undefined }),
  close: () => set({ isOpen: false }),
  setActiveTab: (tab) => set({ activeTab: tab, sectionOpen: true }),
  showSections: () => set({ sectionOpen: false })
}));
