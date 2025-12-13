import type { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "Team Balancer | AQT",
  description: "Balance tournament teams using genetic algorithms on AQT.",
  metadataBase: new URL("https://aqt.craazzzyyfoxx.me"),
  openGraph: {
    title: `Team Balancer | AQT`,
    description: `Balance tournament teams using genetic algorithms on AQT.`,
    url: "https://aqt.craazzzyyfoxx.me/balancer",
    type: "website",
    siteName: "AQT",
    locale: "en_US"
  }
};

export default function BalancerLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <>{children}</>;
}
