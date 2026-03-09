import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import React from "react";
import { Providers } from "@/app/providers";
import { GoogleAnalytics } from "@next/third-parties/google";
import Header from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Separator } from "@/components/ui/separator";
import { SITE_FAVICON, SITE_NAME } from "@/config/site";
import { cn } from "@/lib/utils";
import AuthModal from "@/components/AuthModal";
import AccountSettingsModal from "@/components/AccountSettingsModal";
import LoginModalTrigger from "@/components/LoginModalTrigger";
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

          <div className="w-full max-w-screen-3xl mt-6 mx-auto px-4 md:px-6 xl:px-10 h-full">
            <Header />
            <div className="flex w-full flex-col min-h-[95%]">
              <main className="flex flex-1 flex-col gap-4 pt-4 md:gap-8 md:pt-8 ">
                {children}
              </main>
            </div>
            <Separator className="mt-8" />
            <Footer />
          </div>
        </Providers>
      </body>
    </html>
  );
}
