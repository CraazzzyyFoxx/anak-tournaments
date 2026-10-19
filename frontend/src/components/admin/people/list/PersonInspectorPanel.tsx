"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { ArrowRightLeft, Pencil } from "lucide-react";

import { EYEBROW_CLASS } from "@/components/kit/tone";
import { SocialAccountList } from "@/components/social/SocialAccountList";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { initials } from "@/lib/utils";
import type { AuthAdminUser } from "@/types/rbac.types";
import type { User } from "@/types/user.types";

import { accessAccountsHref } from "./model";

function InspectorField({
  label,
  children
}: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="min-w-0">
      <p className={EYEBROW_CLASS}>{label}</p>
      <div className="mt-1 text-sm text-foreground">{children}</div>
    </div>
  );
}

export function PersonInspectorPanel({
  person,
  account,
  canReadAuth
}: Readonly<{
  person: User;
  account: AuthAdminUser | undefined;
  canReadAuth: boolean;
}>) {
  const t = useTranslations("adminPeople.people");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Avatar className="size-12">
          <AvatarImage src={person.avatar_url ?? undefined} alt="" />
          <AvatarFallback className="bg-muted/60 text-muted-foreground">
            {initials(person.name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate font-medium">{person.name}</p>
          <p className="font-mono text-xs tabular-nums text-muted-foreground">
            #{person.id}
          </p>
        </div>
      </div>

      <section className="rounded-xl border border-border/60 p-3">
        <p className={EYEBROW_CLASS}>
          {t("socialIdentities", { count: person.social_accounts?.length ?? 0 })}
        </p>
        <div className="mt-2">
          {person.social_accounts?.length ? (
            <SocialAccountList accounts={person.social_accounts} linkify={false} />
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
          ) : account ? (
            <Link
              className="text-primary underline-offset-4 hover:underline"
              href={accessAccountsHref(person.name)}
            >
              {account.username || account.email}
            </Link>
          ) : (
            <span className="text-muted-foreground">{t("notLinked")}</span>
          )}
        </InspectorField>
        <InspectorField label={t("stream")}>
          {person.stream_visible === false ? t("hiddenByPlayer") : t("allowed")}
        </InspectorField>
      </div>
    </div>
  );
}

export function PersonInspectorActions({
  person,
  canEditProfile,
  canMerge,
  onEdit,
  onMerge
}: Readonly<{
  person: User;
  canEditProfile: boolean;
  canMerge: boolean;
  onEdit: (person: User) => void;
  onMerge: (person: User) => void;
}>) {
  const t = useTranslations("adminPeople.people");

  return (
    <>
      {canEditProfile ? (
        <Button variant="outline" size="sm" onClick={() => onEdit(person)}>
          <Pencil aria-hidden className="size-3.5" />
          {t("editIdentity")}
        </Button>
      ) : null}
      {canMerge ? (
        <Button variant="outline" size="sm" onClick={() => onMerge(person)}>
          <ArrowRightLeft aria-hidden className="size-3.5" />
          {t("mergeShort")}
        </Button>
      ) : null}
    </>
  );
}
