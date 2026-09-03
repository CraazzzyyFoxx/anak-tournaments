"use client";

import { useCallback, useEffect, useState } from "react";
import { useCommandState } from "cmdk";
import { useRouter } from "next/navigation";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  adminNavItemSearchValue,
  adminRouteAccessOptions,
  type AdminNavGroup,
} from "@/components/admin/admin-navigation";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspaceStore } from "@/stores/workspace.store";

interface AdminCommandPaletteProps {
  groups: AdminNavGroup[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Announces how many pages the current query matched. cmdk filters internally,
 * so the count only exists in command state — without this, a screen reader
 * hears nothing when the visible list shrinks to two entries.
 */
function ResultCountAnnouncer() {
  const count = useCommandState((state) => state.filtered.count);
  const search = useCommandState((state) => state.search);

  return (
    <div role="status" aria-live="polite" className="sr-only">
      {search
        ? `${count} ${count === 1 ? "page matches" : "pages match"} "${search}"`
        : `${count} pages available`}
    </div>
  );
}

export function AdminCommandPalette({ groups, open, onOpenChange }: Readonly<AdminCommandPaletteProps>) {
  const router = useRouter();
  const { canAccessAdminRoute } = usePermissions();
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);

  const handleSelect = useCallback(
    (href: string) => {
      onOpenChange(false);
      router.push(href);
    },
    [router, onOpenChange],
  );

  // A view is a route of its own, and one entry's views can carry different
  // gates than the entry (Access mixes global-RBAC, workspace-admin and
  // superuser-only sections). Gating each against the same route table the
  // layout guard reads keeps the palette from offering an Unauthorized wall.
  const viewEntries = groups.flatMap((group) =>
    group.items.flatMap((item) =>
      (item.views ?? [])
        .filter((view) =>
          canAccessAdminRoute(
            adminRouteAccessOptions(view.href.split("?")[0], currentWorkspaceId),
          ),
        )
        .map((view) => ({ item, view })),
    ),
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput aria-label="Search admin pages" placeholder="Search admin pages…" />
      <ResultCountAnnouncer />
      <CommandList>
        <CommandEmpty>
          No admin page matches that. Try a shorter word, such as &ldquo;teams&rdquo; or
          &ldquo;rank&rdquo;.
        </CommandEmpty>
        {groups.map((group) => (
          <CommandGroup key={group.title || "primary"} heading={group.title || "Overview"}>
            {group.items.map((item) => (
              <CommandItem
                key={item.href}
                value={adminNavItemSearchValue(item)}
                onSelect={() => handleSelect(item.href)}
              >
                <item.icon aria-hidden className="size-4 text-muted-foreground" />
                <div className="flex flex-col gap-0.5">
                  <span>{item.title}</span>
                  <span className="text-xs text-muted-foreground">{item.description}</span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        {/* Views of the multi-view screens. Collapsing five sidebar entries
            into one browser would otherwise make "standings" unfindable: the
            page it lives on is called Matches. */}
        {viewEntries.length > 0 ? (
          <CommandGroup heading="Views">
            {viewEntries.map(({ item, view }) => (
              <CommandItem
                key={view.href}
                value={`${item.title} ${view.label}`}
                onSelect={() => handleSelect(view.href)}
              >
                <item.icon aria-hidden className="size-4 text-muted-foreground" />
                <span>
                  {item.title}
                  <span aria-hidden> › </span>
                  {view.label}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}

export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // "/" when not focused on an input
      if (
        e.key === "/" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target as HTMLElement)?.isContentEditable
      ) {
        e.preventDefault();
        setOpen(true);
      }

      // Ctrl+K / Cmd+K
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return { open, setOpen };
}
