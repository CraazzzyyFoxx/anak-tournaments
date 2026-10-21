"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { revalidateUser } from "@/app/actions/users";
import { adminQueryKeys } from "@/lib/admin/query-keys";
import { getApiErrorMessage } from "@/lib/api/error";
import { notify } from "@/lib/notify";
import adminService from "@/services/admin.service";
import type { User } from "@/types/user.types";

/**
 * A person's avatar and name edits, shared by the hub header and the People
 * browser's profile dialog so the two cannot drift apart.
 *
 * `applyUser` is where every identity write lands, the social editor's too:
 * it busts the Next Data Cache (users/[slug], the list and search) and writes
 * the server's copy into the hub's person entry. That entry is picked out of
 * the full list (`admin/people/[id]/page.tsx`), so invalidating the list alone
 * would leave the hub showing the old name until its own refetch.
 */
export function usePersonEdit(personId: number, onUpdated?: (user: User) => void) {
  const t = useTranslations("adminPeople.profile");
  const queryClient = useQueryClient();

  const applyUser = (user: User) => {
    void revalidateUser(user.id);
    queryClient.setQueryData(adminQueryKeys.person(user.id), user);
    onUpdated?.(user);
  };
  const saved = (user: User) => {
    void queryClient.invalidateQueries({ queryKey: adminQueryKeys.users() });
    applyUser(user);
  };
  // One toast: what failed as its title, the server's reason under it.
  const failed = (title: string) => (error: unknown) =>
    notify.error(title, { description: getApiErrorMessage(error, "") || undefined });

  const uploadAvatar = useMutation({
    meta: { suppressErrorToast: true },
    mutationFn: (file: File) => adminService.uploadUserAvatar(personId, file),
    onSuccess: saved,
    onError: failed(t("avatarUpdateError"))
  });
  const deleteAvatar = useMutation({
    meta: { suppressErrorToast: true },
    mutationFn: () => adminService.deleteUserAvatar(personId),
    onSuccess: saved,
    onError: failed(t("avatarUpdateError"))
  });
  const rename = useMutation({
    meta: { suppressErrorToast: true },
    mutationFn: (name: string) => adminService.updateUser(personId, { name }),
    onSuccess: saved,
    onError: failed(t("saveError"))
  });

  return {
    uploadAvatar,
    deleteAvatar,
    rename,
    applyUser,
    avatarBusy: uploadAvatar.isPending || deleteAvatar.isPending
  };
}
