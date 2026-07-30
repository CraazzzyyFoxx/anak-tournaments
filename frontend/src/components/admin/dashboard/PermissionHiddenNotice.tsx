import { Lock } from "lucide-react";

interface PermissionHiddenNoticeProps {
  /** What is hidden, phrased as a statement: "Tournament data is hidden". */
  title: string;
  /** Which permission the reader needs, e.g. "tournament read". */
  permission: string;
}

/**
 * The dashboard's permission-denied panel. Both tournament cards rendered a
 * verbatim copy of this block; they share it now so the wording stays one
 * sentence that names who can grant access.
 */
export function PermissionHiddenNotice({ title, permission }: PermissionHiddenNoticeProps) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border/70 bg-background/45 p-5 text-sm text-muted-foreground">
      <div className="flex items-center gap-2 text-foreground">
        <Lock className="size-4 text-muted-foreground" aria-hidden />
        <span className="font-medium">{title}</span>
      </div>
      <p className="leading-6">
        Ask a workspace administrator to grant your role the {permission} permission.
      </p>
    </div>
  );
}
