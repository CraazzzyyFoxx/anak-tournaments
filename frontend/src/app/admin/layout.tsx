import type { ReactNode } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { AdminLayoutClient } from "@/app/admin/AdminLayoutClient";
import { AuthProfileSeed } from "@/components/auth/AuthProfileSeed";
import ZoneIntlProvider from "@/i18n/ZoneIntlProvider";
import { getAccessToken, getRefreshToken } from "@/lib/auth/cookies";
import { devLoginCredentials } from "@/lib/auth/dev-login";
import { fetchAuthProfileResponse, mapAuthProfile } from "@/lib/auth/profile";
import { SIDEBAR_COOKIE_NAMES, parseSidebarOpenCookie } from "@/lib/site/sidebar-cookies";
import type { AuthProfile } from "@/stores/auth-profile.store";

type AdminLayoutProps = {
  children: ReactNode;
};

// The panel's identity, resolved once on the server instead of once per page
// load in the browser. EVERY failure degrades to `null`, which is exactly the
// behaviour this layout had before — the client fetches `/auth/me` itself and
// the shell shows its spinner until it lands — so neither an access cookie
// that merely expired (the refresh cookie rescues it client-side, which no
// layout can do: it cannot set cookies) nor an identity-svc outage turns an
// admin page into a 500.
async function resolveServerProfile(accessToken: string): Promise<AuthProfile | null> {
  try {
    const response = await fetchAuthProfileResponse(accessToken);
    if (!response.ok) {
      return null;
    }
    return mapAuthProfile(await response.json());
  } catch {
    return null;
  }
}

export default async function AdminLayout({ children }: Readonly<AdminLayoutProps>) {
  const cookieStore = await cookies();
  const accessToken = getAccessToken(cookieStore);

  // Neither session cookie: there is nothing the browser could recover from, so
  // the visitor is signed out — bounce them off the zone before they download
  // any of it. `?login=1&next=` is the site's own sign-in entry (see
  // `LoginModalTrigger`): it opens the auth modal on `/` and returns here after.
  // A `next dev` with DEV_AUTH_* set signs in by password instead (OAuth cannot
  // return to localhost).
  if (!accessToken && !getRefreshToken(cookieStore)) {
    const returnTo = encodeURIComponent((await headers()).get("x-owt-pathname") ?? "/admin");
    redirect(devLoginCredentials() ? `/auth/dev-login?next=${returnTo}` : `/?login=1&next=${returnTo}`);
  }

  const profile = accessToken ? await resolveServerProfile(accessToken) : null;

  const defaultSidebarOpen =
    parseSidebarOpenCookie(cookieStore.get(SIDEBAR_COOKIE_NAMES.admin)?.value) ?? true;

  return (
    <ZoneIntlProvider zone="admin">
      {profile ? <AuthProfileSeed profile={profile} /> : null}
      <AdminLayoutClient defaultSidebarOpen={defaultSidebarOpen}>{children}</AdminLayoutClient>
    </ZoneIntlProvider>
  );
}
