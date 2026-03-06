"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useAuthModalStore } from "@/stores/auth-modal.store";

const LoginModalTrigger = () => {
  const searchParams = useSearchParams();
  const open = useAuthModalStore((state) => state.open);

  const loginParam = searchParams.get("login");
  const nextParam = searchParams.get("next") ?? "/";

  useEffect(() => {
    if (loginParam === "1") {
      open(nextParam);
    }
  }, [loginParam, nextParam, open]);

  return null;
};

export default LoginModalTrigger;
