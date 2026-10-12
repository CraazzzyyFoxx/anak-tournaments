import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";

import { EmptyNote } from "@/components/kit/EmptyNote";

interface PermissionHiddenNoticeProps {
  /** What is hidden, phrased as a statement: "Tournament data is hidden". */
  title: string;
  /** Which permission the reader needs, e.g. "tournament read". */
  permission: string;
}

/**
 * The dashboard's permission-denied panel: one sentence that names who can
 * grant access, on the admin's shared dashed note.
 */
export function PermissionHiddenNotice({
  title,
  permission
}: Readonly<PermissionHiddenNoticeProps>) {
  const t = useTranslations("adminShell.dashboard");
  return (
    <EmptyNote icon={Lock} title={title}>
      {t("permissionNotice", { permission })}
    </EmptyNote>
  );
}
