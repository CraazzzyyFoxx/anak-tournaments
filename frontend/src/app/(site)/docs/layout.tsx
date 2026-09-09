import type { Metadata } from "next";
import type { ReactNode } from "react";

import { DocsShell } from "./DocsShell";

export const metadata: Metadata = {
  title: "Документация · OWT",
  description:
    "Платформа турниров Overwatch: воркспейсы, сетка, регистрация, API v1/v2, схема данных.",
};

export default function DocsLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <DocsShell>{children}</DocsShell>;
}
