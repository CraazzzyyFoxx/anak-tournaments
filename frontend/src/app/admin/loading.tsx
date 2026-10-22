import { useTranslations } from "next-intl";

import { AdminContentSkeleton } from "@/app/admin/AdminLayoutClient";

/**
 * Renders inside the admin shell (a segment's `loading` never wraps its own
 * layout), so it draws only the page area, the same outline the shell shows
 * while permissions load.
 */
export default function Loading() {
  const t = useTranslations("adminShell.layout");
  return (
    <>
      <span role="status" className="sr-only">
        {t("loading")}
      </span>
      <AdminContentSkeleton />
    </>
  );
}
