import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import React from "react";
import { Providers } from "@/app/providers";
import { GoogleAnalytics } from "@next/third-parties/google";
import { SITE_FAVICON, SITE_NAME } from "@/config/site";
import { cn } from "@/lib/utils";
import AuthModal from "@/components/AuthModal";
import AccountSettingsModal from "@/components/AccountSettingsModal";
import LoginModalTrigger from "@/components/LoginModalTrigger";
import { Toaster } from "@/components/ui/toaster";
import { Suspense } from "react";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: SITE_NAME,
  description: `${SITE_NAME} is a tool for analyzing Anak's tournaments.`,
  metadataBase: new URL("https://aqt.craazzzyyfoxx.me"),
  icons: {
    icon: SITE_FAVICON
  },
  openGraph: {
    title: SITE_NAME,
    description: `${SITE_NAME} is a tool for analyzing Anak's tournaments.`,
    url: "https://aqt.craazzzyyfoxx.me",
    type: "website",
    siteName: SITE_NAME,
    locale: "en_US"
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={cn(inter.className, "dark")}>
        <GoogleAnalytics gaId="G-6TYE0K6SQM" />
        <Providers>
          <Suspense fallback={null}>
            <LoginModalTrigger />
          </Suspense>
          <AuthModal />
          <Suspense fallback={null}>
            <AccountSettingsModal />
          </Suspense>
          <Toaster />
          {children}
        </Providers>
      </body>
    </html>
  );
}
