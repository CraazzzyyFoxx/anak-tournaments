import type { Metadata } from "next";
import React from "react";
import { SidebarProvider } from "@/components/ui/sidebar";

export const metadata: Metadata = {
  title: "Tournaments | AQT",
  description: "View tournaments on AQT.",
  metadataBase: new URL("https://aqt.craazzzyyfoxx.me"),
  openGraph: {
    title: `AQT`,
    description: `View tournaments on AQT.`,
    url: "https://aqt.craazzzyyfoxx.me",
    type: "website",
    siteName: "AQT",
    locale: "en_US"
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <SidebarProvider>{children}</SidebarProvider>;
}
