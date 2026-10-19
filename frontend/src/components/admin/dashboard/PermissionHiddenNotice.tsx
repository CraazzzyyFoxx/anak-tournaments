import { Lock } from "lucide-react";

import { EmptyNote } from "@/components/kit/EmptyNote";

interface PermissionHiddenNoticeProps {
  /** What is hidden, phrased as a statement: "Tournament data is hidden". */
  title: string;
  /** Who can grant access and which permission, as one translated sentence. */
  description: string;
}

/**
 * The dashboard's permission-denied panel: one sentence that names who can
 * grant access, on the admin's shared dashed note.
 */
export function PermissionHiddenNotice({
  title,
  description
}: Readonly<PermissionHiddenNoticeProps>) {
  return (
    <EmptyNote icon={Lock} title={title}>
      {description}
    </EmptyNote>
  );
}
