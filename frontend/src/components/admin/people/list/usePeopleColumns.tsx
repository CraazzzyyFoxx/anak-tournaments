"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowRightLeft, Pencil, Trash2, UserCog } from "lucide-react";

import { columnMeta, createKebabColumn } from "@/components/data-table";
import { SocialAccountList } from "@/components/social/SocialAccountList";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initials } from "@/lib/utils";
import type { AuthAdminUser } from "@/types/rbac.types";
import type { User } from "@/types/user.types";

import { accessAccountsHref } from "./model";

export function usePeopleColumns({
  canReadAuth,
  canEditProfile,
  canMerge,
  canDelete,
  authByPlayerId,
  onEdit,
  onMerge,
  onDelete
}: Readonly<{
  canReadAuth: boolean;
  canEditProfile: boolean;
  canMerge: boolean;
  canDelete: boolean;
  authByPlayerId: ReadonlyMap<number, AuthAdminUser>;
  onEdit: (person: User) => void;
  onMerge: (person: User) => void;
  onDelete: (person: User) => void;
}>): ColumnDef<User>[] {
  const t = useTranslations("adminPeople.people");

  return useMemo<ColumnDef<User>[]>(
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
        meta: columnMeta<User>({ align: "center" }),
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
            hidden: !canEditProfile,
            onSelect: () => onEdit(person)
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
            onSelect: () => onMerge(person)
          },
          {
            label: t("actions.delete"),
            icon: Trash2,
            destructive: true,
            hidden: !canDelete,
            onSelect: () => onDelete(person)
          }
        ],
        { rowLabel: (person) => person.name }
      )
    ],
    [t, canReadAuth, canEditProfile, canMerge, canDelete, authByPlayerId, onEdit, onMerge, onDelete]
  );
}
