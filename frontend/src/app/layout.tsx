import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Onest } from "next/font/google";
import "./globals.css";
import React from "react";

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-inter",
  display: "swap"
});

// Editorial Tactical display face (design-book): cyrillic-native geometric
// grotesk used for page-hero titles. Mixed-case, never condensed-caps.
const onest = Onest({
  subsets: ["latin", "cyrillic"],
  weight: ["500", "600", "700"],
  variable: "--font-onest",
  display: "swap"
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jetbrains-mono",
  display: "swap"
});

import { Providers } from "@/app/providers";
import { cn } from "@/lib/utils";
import AuthModal from "@/components/AuthModal";
import AccountSettingsModal from "@/components/AccountSettingsModal";
import LoginModalTrigger from "@/components/LoginModalTrigger";
import { Toaster } from "@/components/ui/sonner";
import { Suspense } from "react";
import { resolveSiteMetadata } from "@/lib/site-metadata";
import { resolveTenantWorkspace } from "@/lib/tenant-host";
import { COOKIE_CONSENT_COOKIE } from "@/lib/cookie-consent";
import CookieConsent from "@/components/CookieConsent";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { cookies } from "next/headers";

export async function generateMetadata(): Promise<Metadata> {
  const [{ name, description, origin, icon }, locale] = await Promise.all([
    resolveSiteMetadata(),
    getLocale()
  ]);
  return {
    title: name,
    description,
    metadataBase: new URL(origin),
    icons: {
      icon,
      apple: "/apple-touch-icon.png"
    },
    openGraph: {
      title: name,
      description,
      url: origin,
      type: "website",
      siteName: name,
      locale: locale === "ru" ? "ru_RU" : "en_US"
    }
  };
}

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [locale, tenantWorkspace, cookieStore] = await Promise.all([
    getLocale(),
    resolveTenantWorkspace(),
    cookies()
  ]);
  // Analytics only loads for a visitor who accepted it; anything other than an
  // explicit decision leaves the notice to ask.
  const rawConsent = cookieStore.get(COOKIE_CONSENT_COOKIE)?.value;
  const cookieConsent =
    rawConsent === "accepted" || rawConsent === "declined" ? rawConsent : null;
  return (
    <html lang={locale}>
      <body
        className={cn(
          inter.className,
          inter.variable,
          jetbrainsMono.variable,
          onest.variable,
          "dark"
        )}
      >
        <NextIntlClientProvider>
          <Providers>
            <Suspense fallback={null}>
              <LoginModalTrigger />
            </Suspense>
            <AuthModal tenantWorkspace={tenantWorkspace ?? undefined} />
            <Suspense fallback={null}>
              <AccountSettingsModal />
            </Suspense>
            <CookieConsent initial={cookieConsent} gaId="G-6TYE0K6SQM" />
            <Toaster />
            {children}
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
