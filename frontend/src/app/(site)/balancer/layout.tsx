import type { Metadata } from "next";
import React from "react";
import { SITE_NAME } from "@/config/site";

export const metadata: Metadata = {
  title: `Team Balancer | ${SITE_NAME}`,
  description: `Balance tournament teams using genetic algorithms on ${SITE_NAME}.`,
  metadataBase: new URL("https://aqt.craazzzyyfoxx.me"),
  openGraph: {
    title: `Team Balancer | ${SITE_NAME}`,
    description: `Balance tournament teams using genetic algorithms on ${SITE_NAME}.`,
    url: "https://aqt.craazzzyyfoxx.me/balancer",
    type: "website",
    siteName: SITE_NAME,
    locale: "en_US"
  }
};

export default function BalancerLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <>{children}</>;
}
