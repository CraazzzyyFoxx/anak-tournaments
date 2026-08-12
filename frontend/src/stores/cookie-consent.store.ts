import { create } from "zustand";

type CookieConsentStore = {
  /**
   * Set when the visitor asks to revisit a choice they already made. The notice
   * itself lives in the root layout and the "Cookie settings" control in the
   * site footer, so the request has to travel through a store rather than props.
   */
  isReopened: boolean;
  reopen: () => void;
  close: () => void;
};

export const useCookieConsentStore = create<CookieConsentStore>((set) => ({
  isReopened: false,
  reopen: () => set({ isReopened: true }),
  close: () => set({ isReopened: false })
}));
