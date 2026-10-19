"use client";

import { useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Pencil, Plus, Trash2, UserCog } from "lucide-react";

import { DataTable, columnMeta, createKebabColumn } from "@/components/data-table";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AuthUserSearchCombobox } from "@/components/kit/AuthUserSearchCombobox";
import { EntityFormDialog } from "@/components/kit/EntityFormDialog";
import { PlayerProfileDialog } from "@/components/admin/PlayerProfileDialog";
import { UserMergeDialog } from "@/components/admin/UserMergeDialog";
import { FilterBar } from "@/components/kit/FilterBar";
import { Inspector } from "@/components/kit/Inspector";
import { ConfirmDialog } from "@/components/kit/ConfirmDialog";
import { useFilters, type FilterDef } from "@/components/kit/useFilters";
import { EYEBROW_CLASS } from "@/components/kit/tone";
import { TOURNAMENT_QUERY_PARAM } from "@/components/admin/tournament-filter";
import { SocialAccountList } from "@/components/social/SocialAccountList";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePermissions } from "@/hooks/usePermissions";
import { useQueryParams } from "@/hooks/useQueryParams";
import { hasUnsavedChanges } from "@/lib/form-change";
import { notify } from "@/lib/notify";
import { cn, initials } from "@/lib/utils";
import adminService from "@/services/admin.service";
import { rbacService } from "@/services/rbac.service";
import tournamentService from "@/services/tournament.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { AuthAdminUser } from "@/types/rbac.types";
import type { User } from "@/types/user.types";
import { accessQueryKeys } from "@/lib/access/query-keys";
import { adminQueryKeys } from "@/lib/admin/query-keys";
import { tournamentQueryKeys } from "@/lib/tournament/query-keys";

const PAGE_SIZE = 20;

function accessAccountsHref(name: string): string {
  return `/admin/access/accounts?q=${encodeURIComponent(name.split("#")[0] || name)}`;
}

function InspectorField({
  label,
  children
}: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div className="min-w-0">
      <p className={EYEBROW_CLASS}>{label}</p>
      <div className="mt-1 text-sm text-foreground">{children}</div>
    </div>
  );
}

/**
 * People — every player identity in the workspace, and what is attached to it.
 *
 * Replaces `/admin/users` (the identity list) and `/admin/players` (the
 * cross-tournament roster table, now the Participations tab of one person).
 *
 * Server-paged. Chip filters ride on GET /admin/users: `unlinked` is no
 * social_account row, `has-account` is `auth_user_id IS NOT NULL`, tournament
 * is a roster EXISTS. Auth labels still come from RBAC (`listUsersAll`).
 */
export default function PeoplePage() {
  const t = useTranslations("adminPeople.people");
  const queryClient = useQueryClient();
  const { canAccessPermission, hasPermission, isSuperuser, isLoaded } = usePermissions();
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const formId = useId();
  const nameFieldId = `${formId}-name`;

  // `id` is the inspector, not a filter: opening a row must not drop the page
  // the row is on, so nothing resets here.
  const { searchParams, setParams } = useQueryParams({ resetOnChange: [], shallow: true });
  const openId = searchParams?.get("id") ?? null;

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  // Optionally link the new player to an existing auth account on creation.
  const [linkAuthUserId, setLinkAuthUserId] = useState<number | null>(null);
  const [linkAuthUserLabel, setLinkAuthUserLabel] = useState("");
  const [profileUser, setProfileUser] = useState<User | null>(null);
  const [mergeUser, setMergeUser] = useState<User | null>(null);
  const [pendingDelete, setPendingDelete] = useState<User | null>(null);
  const [pageRows, setPageRows] = useState<User[]>([]);

  // A player identity is platform-wide: creating, renaming or deleting one
  // reaches every workspace that plays with it, so those stay on the GLOBAL
  // grant. A workspace-scoped `user.read` opens the page and the list, not the
  // writes; `hasPermission` is the global check, `canAccessPermission` also
  // answers to a workspace grant.
  const canRead = canAccessPermission("user.read", workspaceId);
  const canCreate = hasPermission("user.create");
  const canUpdate = hasPermission("user.update");
  const canDelete = hasPermission("user.delete");
  const canLinkAuth = hasPermission("auth_user.update");
  const canReadAuth = hasPermission("auth_user.read");
  const canMerge = isSuperuser;
  // Identity (social account) management is superuser-only; display visibility
  // can be toggled by anyone with read access.
  const canManageIdentity = isSuperuser;
  const canSetVisibility = canRead;

  // The auth side of the "Account" column. Global grant only — without it the
  // column says so rather than pretending every identity is unlinked.
  const authQuery = useQuery({
    queryKey: accessQueryKeys.usersAll(),
    queryFn: () => rbacService.listUsersAll(),
    enabled: canRead && canReadAuth
  });

  const tournamentsQuery = useQuery({
    queryKey: tournamentQueryKeys.list(),
    queryFn: () => tournamentService.getAll(null),
    enabled: canRead
  });

  const defs = useMemo<FilterDef[]>(
    () => [
      {
        key: TOURNAMENT_QUERY_PARAM,
        label: t("filters.tournament"),
        kind: "single",
        options: (tournamentsQuery.data?.results ?? []).map((tournament) => ({
          value: String(tournament.id),
          label: tournament.name
        }))
      },
      { key: "has-account", label: t("filters.hasAccount"), kind: "toggle" },
      { key: "unlinked", label: t("filters.noIdentities"), kind: "toggle" }
    ],
    [t, tournamentsQuery.data]
  );

  const filters = useFilters(defs);
  const tournamentFilter = String(filters.values[TOURNAMENT_QUERY_PARAM] ?? "");
  const hasAccountFilter = filters.values["has-account"] === true;
  const unlinkedFilter = filters.values.unlinked === true;

  const authByPlayerId = useMemo(() => {
    const map = new Map<number, AuthAdminUser>();
    for (const account of authQuery.data ?? []) {
      for (const link of account.linked_players) map.set(link.player_id, account);
    }
    return map;
  }, [authQuery.data]);

  const openRow = pageRows.find((person) => String(person.id) === openId) ?? null;
  const openIndex = openRow ? pageRows.indexOf(openRow) : -1;
  const openAccount = openRow ? authByPlayerId.get(openRow.id) : undefined;

  const resetCreateForm = () => {
    setCreateName("");
    setLinkAuthUserId(null);
    setLinkAuthUserLabel("");
  };

  const createMutation = useMutation({
    // Create the player, then (optionally) link it to an auth account. The link
    // is a second call; if it fails we still report the player as created and
    // surface a warning rather than throwing — re-submitting would otherwise
    // create a duplicate player. The admin can retry the link from Access.
    mutationFn: async (input: { name: string; authUserId: number | null }) => {
      const person = await adminService.createUser({ name: input.name });
      if (input.authUserId == null) return { person, linkWarning: undefined as { name: string; detail: string } | undefined };
      try {
        await rbacService.assignLinkedPlayer(input.authUserId, {
          player_id: person.id,
          is_primary: true
        });
        return { person, linkWarning: undefined as { name: string; detail: string } | undefined };
      } catch (error) {
        const detail = error instanceof Error ? error.message : t("unknownError");
        return {
          person,
          linkWarning: { name: person.name, detail }
        };
      }
    },
    onSuccess: ({ linkWarning }) => {
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.users() });
      queryClient.invalidateQueries({ queryKey: accessQueryKeys.users() });
      setCreateOpen(false);
      resetCreateForm();
      if (linkWarning) notify.error(t("linkFailed", linkWarning));
      else notify.success(t("created"));
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminService.deleteUser(id),
    onSuccess: () => {
      const removed = pendingDelete;
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.users() });
      setPendingDelete(null);
      if (removed && String(removed.id) === openId) setParams({ id: null });
      notify.success(t("deleted"));
    }
  });

  const columns = useMemo<ColumnDef<User>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("columns.person"),
        meta: columnMeta<User>({
          sticky: true,
          searchValue: (person) => `${person.name} ${person.id}`
        }),
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar className="size-7 text-xs">
              <AvatarImage src={row.original.avatar_url ?? undefined} alt="" />
              <AvatarFallback className="bg-muted/60 font-medium text-muted-foreground">
                {initials(row.original.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground">{row.original.name}</p>
              <p className="font-mono text-xs tabular-nums text-muted-foreground">
                #{row.original.id}
              </p>
            </div>
          </div>
        )
      },
      {
        id: "identities",
        header: t("columns.identities"),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.social_accounts?.length ? (
            <SocialAccountList accounts={row.original.social_accounts} linkify={false} />
          ) : (
            <span className="text-xs italic text-muted-foreground">{t("noIdentitiesLinked")}</span>
          )
      },
      {
        id: "account",
        header: t("columns.account"),
        enableSorting: false,
        cell: ({ row }) => {
          if (!canReadAuth) {
            return (
              <span
                className="text-sm text-muted-foreground"
                title={t("authGrant")}
              >
                —
              </span>
            );
          }
          const account = authByPlayerId.get(row.original.id);
          if (!account) {
            return <span className="text-sm text-muted-foreground">{t("notLinked")}</span>;
          }
          return (
            <span className="truncate text-sm" title={account.email}>
              {account.username || account.email}
            </span>
          );
        }
      },
      createKebabColumn<User>(
        (person) => [
          { label: t("actions.openPerson"), href: `/admin/people/${person.id}` },
          {
            label: t("actions.edit"),
            icon: Pencil,
            hidden: !canUpdate && !canManageIdentity && !canSetVisibility,
            onSelect: () => setProfileUser(person)
          },
          {
            label: t("actions.access"),
            icon: UserCog,
            hidden: !canReadAuth,
            href: accessAccountsHref(person.name)
          },
          {
            label: t("actions.merge"),
            icon: ArrowRightLeft,
            hidden: !canMerge,
            onSelect: () => setMergeUser(person)
          },
          {
            label: t("actions.delete"),
            icon: Trash2,
            destructive: true,
            hidden: !canDelete,
            onSelect: () => setPendingDelete(person)
          }
        ],
        { rowLabel: (person) => person.name }
      )
    ],
    [t, canReadAuth, canUpdate, canManageIdentity, canSetVisibility, canMerge, canDelete, authByPlayerId]
  );

  if (!isLoaded) {
    return <div className="h-40 animate-pulse rounded-lg bg-muted/40 motion-reduce:animate-none" />;
  }

  if (!canRead) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("unauthorized")}</CardTitle>
          <CardDescription>
            {t("noPermission")}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const isCreateDirty =
    createOpen &&
    hasUnsavedChanges(
      { name: createName, authUserId: linkAuthUserId },
      { name: "", authUserId: null }
    );

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title={t("title")}
        description={t("description")}
      />

      <div
        className={cn("grid items-start gap-4", openRow && "lg:grid-cols-[minmax(0,1fr)_380px]")}
      >
        <div className="min-w-0">
          <DataTable<User>
            queryKey={(page, search, pageSize, sortField, sortDir) => [
              "admin",
              "users",
              page,
              search,
              pageSize,
              sortField,
              sortDir,
              tournamentFilter,
              hasAccountFilter,
              unlinkedFilter
            ]}
            queryFn={(page, search, pageSize, sortField, sortDir) =>
              adminService.getUsers({
                page,
                per_page: pageSize,
                search: search || undefined,
                sort: sortField ?? undefined,
                order: sortDir,
                tournament_id: tournamentFilter ? Number(tournamentFilter) : undefined,
                has_account: hasAccountFilter || undefined,
                unlinked: unlinkedFilter || undefined
              })
            }
            onPageRowsChange={setPageRows}
            columns={columns}
            initialPageSize={PAGE_SIZE}
            filterKey={filters.filterKey}
            inspectorId={openId}
            getRowId={(person) => String(person.id)}
            toolbar={
              <FilterBar
                defs={defs}
                filters={filters}
                trailing={
                  canCreate ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        createMutation.reset();
                        resetCreateForm();
                        setCreateOpen(true);
                      }}
                    >
                      <Plus aria-hidden className="size-4" />
                      {t("create")}
                    </Button>
                  ) : null
                }
              />
            }
            searchPlaceholder={t("search")}
            emptyMessage={
              canCreate
                ? t("emptyCreate")
                : t("empty")
            }
            onRowClick={(row) => setParams({ id: String(row.original.id) })}
          />
        </div>

        <Inspector
          openId={openRow ? openId : null}
          onClose={() => setParams({ id: null })}
          title={openRow?.name ?? ""}
          subtitle={openRow ? `Identity #${openRow.id}` : undefined}
          openHref={openRow ? `/admin/people/${openRow.id}` : undefined}
          onPrev={
            openIndex > 0 ? () => setParams({ id: String(pageRows[openIndex - 1].id) }) : undefined
          }
          onNext={
            openIndex >= 0 && openIndex < pageRows.length - 1
              ? () => setParams({ id: String(pageRows[openIndex + 1].id) })
              : undefined
          }
          actions={
            openRow ? (
              <>
                {canUpdate || canManageIdentity || canSetVisibility ? (
                  <Button variant="outline" size="sm" onClick={() => setProfileUser(openRow)}>
                    <Pencil aria-hidden className="size-3.5" />
                    {t("editIdentity")}
                  </Button>
                ) : null}
                {canMerge ? (
                  <Button variant="outline" size="sm" onClick={() => setMergeUser(openRow)}>
                    <ArrowRightLeft aria-hidden className="size-3.5" />
                    {t("mergeShort")}
                  </Button>
                ) : null}
              </>
            ) : null
          }
        >
          {openRow ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Avatar className="size-12">
                  <AvatarImage src={openRow.avatar_url ?? undefined} alt="" />
                  <AvatarFallback className="bg-muted/60 text-muted-foreground">
                    {initials(openRow.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate font-medium">{openRow.name}</p>
                  <p className="font-mono text-xs tabular-nums text-muted-foreground">
                    #{openRow.id}
                  </p>
                </div>
              </div>

              <section className="rounded-xl border border-border/60 p-3">
                <p className={EYEBROW_CLASS}>
                  {t("socialIdentities", { count: openRow.social_accounts?.length ?? 0 })}
                </p>
                <div className="mt-2">
                  {openRow.social_accounts?.length ? (
                    <SocialAccountList accounts={openRow.social_accounts} linkify={false} />
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {t("nothingLinked")}
                    </p>
                  )}
                </div>
              </section>

              <div className="grid grid-cols-2 gap-3">
                <InspectorField label={t("columns.account")}>
                  {!canReadAuth ? (
                    <span
                      className="text-muted-foreground"
                      title={t("authGrant")}
                    >
                      —
                    </span>
                  ) : openAccount ? (
                    <Link
                      className="text-primary underline-offset-4 hover:underline"
                      href={accessAccountsHref(openRow.name)}
                    >
                      {openAccount.username || openAccount.email}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">{t("notLinked")}</span>
                  )}
                </InspectorField>
                <InspectorField label={t("stream")}>
                  {openRow.stream_visible === false ? t("hiddenByPlayer") : t("allowed")}
                </InspectorField>
              </div>
            </div>
          ) : null}
        </Inspector>
      </div>

      <EntityFormDialog
        open={createOpen}
        onOpenChange={(next) => {
          if (!next) {
            setCreateOpen(false);
            resetCreateForm();
          }
        }}
        title={t("createTitle")}
        description={t("createDescription")}
        onSubmit={(event) => {
          event.preventDefault();
          createMutation.mutate({ name: createName, authUserId: linkAuthUserId });
        }}
        isSubmitting={createMutation.isPending}
        submittingLabel={t("creating")}
        errorMessage={
          createMutation.error instanceof Error
            ? t("createError", { detail: createMutation.error.message })
            : undefined
        }
        isDirty={isCreateDirty}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={nameFieldId}>{t("nameRequired")}</Label>
            <Input
              id={nameFieldId}
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              placeholder={t("namePlaceholder")}
              required
            />
          </div>
          {canLinkAuth && (
            <div className="space-y-2">
              <Label htmlFor="link-auth-account">{t("linkAccount")}</Label>
              <AuthUserSearchCombobox
                id="link-auth-account"
                value={linkAuthUserId ?? undefined}
                selectedLabel={linkAuthUserLabel || undefined}
                onSelect={(account) => {
                  setLinkAuthUserId(account?.id ?? null);
                  setLinkAuthUserLabel(account?.label ?? "");
                }}
              />
              <p className="text-xs text-muted-foreground">
                {t("linkAccountDescription")}
              </p>
            </div>
          )}
        </div>
      </EntityFormDialog>

      {profileUser ? (
        <PlayerProfileDialog
          key={profileUser.id}
          user={profileUser}
          onClose={() => setProfileUser(null)}
          canEdit={canUpdate}
          canManageIdentity={canManageIdentity}
          canSetVisibility={canSetVisibility}
          workspaceId={workspaceId}
          canMerge={canMerge}
          onMergeRequested={(person) => setMergeUser(person)}
        />
      ) : null}

      {mergeUser ? (
        <UserMergeDialog
          key={mergeUser.id}
          sourceUser={mergeUser}
          open
          onOpenChange={(next) => {
            if (!next) setMergeUser(null);
          }}
          onMerged={() => {
            if (profileUser?.id === mergeUser.id) setProfileUser(null);
            if (String(mergeUser.id) === openId) setParams({ id: null });
            setMergeUser(null);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={pendingDelete != null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
        pending={deleteMutation.isPending}
        intent={{
          title: t("deleteTitle"),
          description: t("deleteDescription", { name: pendingDelete?.name ?? t("thisIdentity") }),
          confirmLabel: t("deleteConfirm"),
          tone: "danger",
          cascade: [
            t("columns.identities"),
            t("columns.identities"),
            t("columns.identities"),
            t("columns.person")
          ]
        }}
        onConfirm={() => {
          if (pendingDelete) deleteMutation.mutate(pendingDelete.id);
        }}
      />
    </div>
  );
}
