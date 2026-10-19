"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive } from "lucide-react";
import { useTranslations } from "next-intl";

import { DataTable } from "@/components/data-table";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { LinkTabs } from "@/components/kit/LinkTabs";
import { ConfirmDialog, type ConfirmIntent } from "@/components/kit/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { useQueryParams } from "@/hooks/useQueryParams";
import { notificationQueryKeys } from "@/lib/notifications/query-keys";
import { notify } from "@/lib/notify";
import notificationService from "@/services/notification.service";
import type { NotificationAdminItem } from "@/types/notification.types";

import { ALL_KINDS, KINDS, KIND_PARAM } from "./model";
import { useNotificationColumns } from "./useNotificationColumns";

/** The server's default page; it caps `per_page` at 100. */
const PAGE_SIZE = 25;

/**
 * The system notifications this workspace's own activity produced — a
 * registration decision, a team invite, a disputed report — and the retire that
 * takes one back out of every recipient's inbox.
 *
 * Scoped by `source_workspace_id`, which is why announcements are not here:
 * they are authored by hand, carry operator-written text in several locales and
 * have their own screen. One row with two delete buttons in two places is how
 * "retired" and "edited" end up disagreeing.
 *
 * "Retire" is not a delete. The server expires the row: it stops reaching any
 * inbox and stops counting toward any badge, while the row and the read marks
 * that record who saw it survive. The confirmation says exactly that, because
 * an operator who expects a hard delete would otherwise assume the evidence is
 * gone.
 *
 * Renders its own page header: the retire-by-kind action in it runs this
 * screen's mutation and confirmation.
 */
export function NotificationsBrowser({
  workspaceId,
  canRetire
}: Readonly<{
  workspaceId: number;
  /** `notification.delete`; without it the table has no retire control at all. */
  canRetire: boolean;
}>) {
  const t = useTranslations<never>();
  const queryClient = useQueryClient();

  const { searchParams } = useQueryParams({ resetOnChange: [] });
  const [confirming, setConfirming] = useState<{ ids?: number[]; kind?: string } | null>(null);
  // Seen from the table's own fetch: the kind retire is pointless on an empty kind.
  const [total, setTotal] = useState<number | null>(null);

  // The filter lives in the URL, not in component state: it decides which rows
  // a bulk retire would take, so "which kind was I looking at" must survive a
  // reload and be linkable to a colleague rather than reset silently.
  const requested = searchParams?.get(KIND_PARAM);
  const kind = requested && KINDS.includes(requested as (typeof KINDS)[number]) ? requested : ALL_KINDS;
  const kindFilter = kind === ALL_KINDS ? null : kind;

  const retire = useMutation({
    mutationFn: (target: { ids?: number[]; kind?: string }) =>
      notificationService.retireWorkspaceNotifications({
        workspaceId,
        ids: target.ids,
        kind: target.kind
      }),
    onSuccess: (result) => {
      notify.success(t("notifications.workspaceAdmin.retired", { count: result.retired }));
      // Both feeds read the same rows: an expired notification has to leave the
      // operator table *and* the bell of everyone still holding it open.
      void queryClient.invalidateQueries({ queryKey: notificationQueryKeys.list() });
    }
  });

  const columns = useNotificationColumns({
    canRetire,
    retirePending: retire.isPending,
    onRetire: setConfirming
  });

  const intent: ConfirmIntent = {
    title: t("notifications.workspaceAdmin.retire.title"),
    description: t("notifications.workspaceAdmin.retire.description"),
    confirmLabel: t("notifications.workspaceAdmin.retire.action"),
    tone: "warning"
  };

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title={t("notifications.workspaceAdmin.title")}
        description={t("notifications.workspaceAdmin.description")}
        actions={
          // Only offered with a kind chosen: "retire everything this workspace
          // ever sent" is not a button, and the server refuses it too.
          canRetire && kindFilter ? (
            <Button
              size="sm"
              variant="outline"
              data-field="retire-kind"
              disabled={retire.isPending || total === 0}
              onClick={() => setConfirming({ kind: kindFilter })}
            >
              <Archive aria-hidden className="size-4" />
              {t("notifications.workspaceAdmin.retire.kindAction")}
            </Button>
          ) : undefined
        }
        footer={
          canRetire ? undefined : (
            <p className="text-xs text-muted-foreground">
              {t("notifications.workspaceAdmin.readOnly")}
            </p>
          )
        }
      />

      <DataTable<NotificationAdminItem>
        columns={columns}
        getRowId={(row) => String(row.id)}
        emptyMessage={t("notifications.workspaceAdmin.empty")}
        initialPageSize={PAGE_SIZE}
        pageSizeOptions={[25, 50, 100]}
        filterKey={kind}
        // The kind row is the table's filter row, and taking the toolbar slot
        // also drops the built-in search box: the server does not search, so
        // a box there would type into nothing. Real links, so a filtered view
        // is linkable and survives a reload.
        toolbar={
          <div data-field="kind" className="min-w-0">
            <LinkTabs
              ariaLabel={t("notifications.workspaceAdmin.kindLabel")}
              activeKey={kind}
              items={[ALL_KINDS, ...KINDS].map((option) => ({
                key: option,
                label:
                  option === ALL_KINDS
                    ? t("notifications.workspaceAdmin.allKinds")
                    : t(`notifications.workspaceAdmin.kinds.${option}` as never),
                href:
                  option === ALL_KINDS
                    ? "/admin/notifications"
                    : `/admin/notifications?${KIND_PARAM}=${option}`
              }))}
            />
          </div>
        }
        // Under the `list()` prefix, so a retire refetches the page on screen.
        queryKey={(page, _search, pageSize) => [
          ...notificationQueryKeys.workspaceNotifications(workspaceId, kindFilter),
          page,
          pageSize
        ]}
        queryFn={(page, _search, pageSize) =>
          notificationService.listWorkspaceNotifications({
            workspaceId,
            kind: kindFilter,
            page,
            perPage: pageSize
          })
        }
        // An empty page is not an empty kind: the kind retire reads the total.
        onPageRowsChange={(_rows, page) => setTotal(page.total)}
      />

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        intent={intent}
        pending={retire.isPending}
        onConfirm={() => {
          if (confirming) retire.mutate(confirming);
          setConfirming(null);
        }}
      />
    </div>
  );
}
