"use client";

import { useTranslations } from "next-intl";

import { SocialAccountsEditor } from "@/components/admin/SocialAccountsEditor";
import { PersonGlance } from "@/components/admin/people/PersonGlance";
import { PersonSection } from "@/components/admin/people/PersonSection";
import { usePersonEdit } from "@/components/admin/people/usePersonEdit";
import type { User } from "@/types/user.types";

/**
 * Who the person is beyond the header: every linked account, and one line per
 * thing that lives on another tab. Name and avatar are the header's.
 */
export function PersonProfileTab({
  person,
  workspaceId,
  canManageIdentity,
  canSetVisibility,
  canReadAuth
}: Readonly<{
  person: User;
  workspaceId: number | null;
  /** Add, edit, delete, verify, set primary (superuser). */
  canManageIdentity: boolean;
  /** Per-workspace and public-profile display toggles (`user.read`). */
  canSetVisibility: boolean;
  canReadAuth: boolean;
}>) {
  const t = useTranslations("adminPeople");
  const { applyUser } = usePersonEdit(person.id);

  return (
    // Capped columns: a switch 900px from its account's name is a row the eye loses.
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,44rem)_minmax(0,24rem)] lg:gap-x-12">
      <PersonSection title={t("profile.socialIdentities")}>
        <SocialAccountsEditor
          userId={person.id}
          accounts={person.social_accounts ?? []}
          canManage={canManageIdentity}
          canSetVisibility={canSetVisibility}
          workspaceId={workspaceId}
          onUserUpdated={applyUser}
        />
      </PersonSection>

      <PersonSection title={t("person.overview")}>
        <PersonGlance personId={person.id} canReadAuth={canReadAuth} />
      </PersonSection>
    </div>
  );
}
