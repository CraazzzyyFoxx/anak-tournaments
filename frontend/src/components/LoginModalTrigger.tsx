"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { notify } from "@/lib/notify";
import { useAuthModalStore } from "@/stores/auth-modal.store";

// Error codes the auth routes redirect with in `?auth_error=` — see
// /auth/{provider}/login (oauth_init_failed), oauth-callback.ts, /auth/sso
// and /auth/link/complete. Anything unrecognized falls back to the generic
// message so future codes are never silently dropped again.
const KNOWN_AUTH_ERRORS: Record<string, true> = {
  oauth_init_failed: true,
  invalid_state: true,
  invalid_provider: true,
  exchange_failed: true,
  invalid_origin: true
};

const LoginModalTrigger = () => {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("auth.errors");
  const open = useAuthModalStore((state) => state.open);

  const loginParam = searchParams.get("login");
  const nextParam = searchParams.get("next") ?? "/";
  const authError = searchParams.get("auth_error");
  const authErrorDescription = searchParams.get("auth_error_description");

  useEffect(() => {
    if (loginParam === "1") {
      open(nextParam);
    }
  }, [loginParam, nextParam, open]);

  useEffect(() => {
    if (!authError) {
      return;
    }

    const key = KNOWN_AUTH_ERRORS[authError] ? authError : "generic";
    // Fixed id: StrictMode double-runs effects in dev — the second toast
    // replaces the first instead of stacking a duplicate.
    notify.error(t(key as "generic"), {
      id: "auth-error",
      description: authErrorDescription ?? undefined
    });

    // Strip the error params so a refresh or back-navigation doesn't re-toast.
    const params = new URLSearchParams(searchParams);
    params.delete("auth_error");
    params.delete("auth_error_description");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [authError, authErrorDescription, pathname, router, searchParams, t]);

  return null;
};

export default LoginModalTrigger;
