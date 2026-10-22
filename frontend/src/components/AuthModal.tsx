"use client";

import { useState } from "react";
import dynamic from "next/dynamic";

import type { AuthModalProps } from "@/components/AuthDialog";
import { useAuthModalStore } from "@/stores/auth-modal.store";

const AuthDialog = dynamic(() => import("@/components/AuthDialog"), { ssr: false });

/**
 * Always-mounted gate for the sign-in dialog: mounts it (a lazy chunk) on the
 * first open, then keeps it mounted so the close animation still plays.
 * `?login=1` is handled by `LoginModalTrigger`.
 */
const AuthModal = (props: AuthModalProps) => {
  const isOpen = useAuthModalStore((state) => state.isOpen);
  const [hasOpened, setHasOpened] = useState(isOpen);
  if (isOpen && !hasOpened) setHasOpened(true);
  return hasOpened ? <AuthDialog {...props} /> : null;
};

export default AuthModal;
