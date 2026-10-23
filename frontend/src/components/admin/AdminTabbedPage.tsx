import type { ReactNode } from "react";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { LinkTabs, type LinkTabItem } from "@/components/kit/LinkTabs";

/** A screen whose sections are routed tabs: the page title, its tab row, then the open section. */
export function AdminTabbedPage({
  title,
  actions,
  tabs,
  activeKey,
  ariaLabel,
  children
}: Readonly<{
  title: string;
  actions?: ReactNode;
  tabs: readonly LinkTabItem[];
  activeKey: string;
  ariaLabel: string;
  children: ReactNode;
}>) {
  return (
    <div className="space-y-4">
      <AdminPageHeader title={title} actions={actions} />
      <LinkTabs items={tabs} activeKey={activeKey} ariaLabel={ariaLabel} />
      {children}
    </div>
  );
}
