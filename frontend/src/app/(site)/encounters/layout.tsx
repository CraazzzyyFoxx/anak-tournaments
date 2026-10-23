import type { Metadata } from "next";
import React from "react";
import { buildSiteRouteMetadata } from "@/lib/site/route-metadata";

export function generateMetadata(): Promise<Metadata> {
  return buildSiteRouteMetadata({
    titleKey: "encounters.meta.title",
    descriptionKey: "encounters.meta.description"
  });
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <>{children}</>;
}
