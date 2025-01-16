import type { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "Users | AQT",
  description: "View users on AQT.",
  metadataBase: new URL("https://aqt.craazzzyyfoxx.me"),
  openGraph: {
    title: `AQT`,
    description: `View users on AQT.`,
    url: "https://aqt.craazzzyyfoxx.me",
    type: "website",
    siteName: "AQT",
    locale: "en_US"
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <>{children}</>;
}
