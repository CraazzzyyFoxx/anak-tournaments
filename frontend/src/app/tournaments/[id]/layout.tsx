import React from "react";
import { SidebarProvider } from "@/components/ui/sidebar";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <SidebarProvider>{children}</SidebarProvider>;
}
