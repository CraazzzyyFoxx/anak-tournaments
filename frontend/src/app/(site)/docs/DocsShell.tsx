"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchField } from "@/components/ui/search-field";
import { cn } from "@/lib/utils";

import { DOC_GROUPS } from "./nav";

export function DocsShell({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const groups = useMemo(() => {
    if (!q) return DOC_GROUPS;
    return DOC_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          item.title.toLowerCase().includes(q) || item.keywords.toLowerCase().includes(q),
      ),
    })).filter((group) => group.items.length > 0);
  }, [q]);

  const activeHref =
    groups.flatMap((g) => g.items).find((item) =>
      item.href === "/docs" ? pathname === "/docs" : pathname === item.href || pathname.startsWith(`${item.href}/`),
    )?.href ?? pathname;

  return (
    <div className="flex flex-col gap-6 pb-16 md:flex-row md:gap-10">
      <aside className="md:w-[220px] md:shrink-0">
        <SearchField
          value={query}
          onValueChange={setQuery}
          label="Поиск по разделам"
          placeholder="Раздел или термин…"
          containerClassName="mb-4"
        />
        <div className="md:hidden">
          <Select value={activeHref} onValueChange={(href) => router.push(href)}>
            <SelectTrigger aria-label="Раздел документации">
              <SelectValue placeholder="Раздел" />
            </SelectTrigger>
            <SelectContent>
              {groups.map((group) => (
                <SelectGroup key={group.label}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.items.map((item) => (
                    <SelectItem key={item.href} value={item.href}>
                      {item.title}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
        <nav aria-label="Разделы документации" className="hidden md:block">
          {groups.length === 0 ? (
            <p className="px-2 text-sm text-muted-foreground">Ничего не найдено по «{query}».</p>
          ) : (
            groups.map((group) => (
              <div key={group.label} className="mb-4 last:mb-0">
                <p className="mb-1.5 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </p>
                <ul className="space-y-0.5">
                  {group.items.map((item) => {
                    const active =
                      !item.bypassNext &&
                      (item.href === "/docs"
                        ? pathname === "/docs"
                        : pathname === item.href || pathname.startsWith(`${item.href}/`));
                    const className = cn(
                      "block rounded-md px-2 py-1.5 text-sm transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "bg-accent/40 font-medium text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    );
                    if (item.bypassNext) {
                      return (
                        <li key={item.href}>
                          <a className={className} href={item.href}>
                            {item.title}
                          </a>
                        </li>
                      );
                    }
                    return (
                      <li key={item.href}>
                        <Link
                          className={className}
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                        >
                          {item.title}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
