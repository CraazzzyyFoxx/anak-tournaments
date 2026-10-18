import type { Metadata } from "next";
import React from "react";
import { buildSiteRouteMetadata } from "@/lib/site/route-metadata";

export function generateMetadata(): Promise<Metadata> {
  return buildSiteRouteMetadata({
    titleKey: "statistics.navTitle",
    descriptionKey: "statistics.metaDescription"
  });
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <>{children}</>;
}
