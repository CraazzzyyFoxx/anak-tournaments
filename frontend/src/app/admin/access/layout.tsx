"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/hooks/usePermissions";

const accessNavItems = [
  { href: "/admin/access/users", label: "Users" },
  { href: "/admin/access/roles", label: "Roles" },
  { href: "/admin/access/permissions", label: "Permissions" },
];

export default function AccessAdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isSuperuser } = usePermissions();

  if (!isSuperuser) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 rounded-lg border border-border/60 bg-card/60 p-2">
        {accessNavItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                isActive && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
      {children}
    </div>
  );
}
