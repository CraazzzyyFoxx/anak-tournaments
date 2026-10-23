// Profile-specific global CSS, loaded with this route's chunk rather than from
// globals.css. The achievements sheet comes along because the profile's
// achievements tab reads the shared `.aqt-rar-*` rarity hues.
import "../achievements/achievements.css";
import "./user-profile.css";

import type { Metadata } from "next";
import React from "react";
import { buildSiteRouteMetadata } from "@/lib/site/route-metadata";

export function generateMetadata(): Promise<Metadata> {
  return buildSiteRouteMetadata({
    titleKey: "users.list.meta.title",
    descriptionKey: "users.list.meta.description"
  });
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <>{children}</>;
}
