import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import React from "react";
import { ThemeProvider } from "next-themes";
import { Providers } from "@/app/providers";
import { cn } from "@/lib/utils";
import { GoogleAnalytics } from "@next/third-parties/google";
import { ClerkProvider } from "@clerk/nextjs";
import Header from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Separator } from "@/components/ui/separator";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AQT",
  description: "AQT is a tool for analyzing Anak`s tournaments.",
  metadataBase: new URL("https://aqt.craazzzyyfoxx.me"),
  openGraph: {
    title: `AQT`,
    description: `AQT is a tool for analyzing Anak's tournaments.`,
    url: "https://aqt.craazzzyyfoxx.me",
    type: "website",
    siteName: "AQT",
    locale: "en_US"
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en" className="h-full">
        <body className={cn(inter.className, "h-full")}>
          <GoogleAnalytics gaId="G-6TYE0K6SQM" />
          <ThemeProvider attribute="class" defaultTheme="dark" disableTransitionOnChange>
            <Providers>
              <div className="w-full max-w-screen-3xl mt-6 mx-auto px-10 h-full">
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
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
