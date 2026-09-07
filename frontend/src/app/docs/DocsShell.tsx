"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";

import { DOC_GROUPS } from "./nav";
import styles from "./docs.module.css";

export function DocsShell({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const schema = pathname === "/docs/schema";
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

  return (
    <div className={styles.root}>
      <header className={styles.topbar}>
        <Link href="/docs" className={styles.brand}>
          <span className={styles.title}>
            OWT <span className={styles.accent}>· документация</span>
          </span>
          <span className={styles.subtitle}>Платформа, API, схема данных</span>
        </Link>
        <a className={styles.topLink} href="/">
          На сайт
        </a>
        <a className={styles.topLink} href="/api/docs">
          Справочник API
        </a>
        {!schema && (
          <div className={styles.search}>
            <span className={styles.searchIcon} aria-hidden>
              ⌕
            </span>
            <input
              className={styles.searchInput}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Раздел или термин…"
              spellCheck={false}
              autoComplete="off"
              aria-label="Поиск по разделам"
            />
            {query ? (
              <button
                type="button"
                className={styles.searchClear}
                onClick={() => setQuery("")}
                aria-label="Очистить поиск"
              >
                ✕
              </button>
            ) : null}
          </div>
        )}
      </header>

      {schema ? (
        children
      ) : (
        <div className={styles.body}>
          <nav className={styles.sidebar} aria-label="Разделы документации">
            {groups.length === 0 && (
              <div className={styles.navEmpty}>Ничего не найдено по «{query}».</div>
            )}
            {groups.map((group) => (
              <div key={group.label}>
                <div className={styles.sidebarHint}>{group.label}</div>
                {group.items.map((item) => {
                  const active =
                    !item.bypassNext &&
                    (item.href === "/docs"
                      ? pathname === "/docs"
                      : pathname === item.href || pathname.startsWith(`${item.href}/`));
                  const className = `${styles.navItem} ${active ? styles.navItemActive : ""}`;
                  const inner = (
                    <div className={styles.navRow}>
                      <span className={styles.navTitle}>{item.title}</span>
                    </div>
                  );
                  if (item.bypassNext) {
                    return (
                      <a key={item.href} className={className} href={item.href}>
                        {inner}
                      </a>
                    );
                  }
                  return (
                    <Link key={item.href} className={className} href={item.href}>
                      {inner}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
          <main className={styles.stage}>{children}</main>
        </div>
      )}
    </div>
  );
}
