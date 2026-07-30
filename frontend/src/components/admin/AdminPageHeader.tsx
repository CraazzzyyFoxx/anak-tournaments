interface AdminPageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  /** Extra line below the title for counts and dates. */
  footer?: React.ReactNode;
}

/**
 * The admin's page title. Owns the page's single `<h1>`, so every admin
 * surface has a document outline — hand-rolled headers were the reason the
 * tournament hub shipped with no heading element at all.
 */
export function AdminPageHeader({
  title,
  description,
  actions,
  meta,
  footer,
}: AdminPageHeaderProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            {/* `title` exposes the full string once truncation kicks in. */}
            <h1
              title={title}
              className="truncate text-lg font-semibold tracking-tight text-foreground"
            >
              {title}
            </h1>
            {meta}
          </div>
          {description && (
            <p className="mt-0.5 truncate text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {footer}
    </div>
  );
}
