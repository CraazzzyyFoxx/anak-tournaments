interface AdminPageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  /**
   * Keep the `<h1>` for the document outline but drop it from the layout.
   * For an entity page whose breadcrumb already resolves the same name,
   * rendering it twice costs a row and says nothing new.
   */
  titleHidden?: boolean;
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
  titleHidden = false,
  footer,
}: Readonly<AdminPageHeaderProps>) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        {/* `flex-1` keeps the shrink-0 actions on this row: a long title or a
            wide meta line used to push them onto a row of their own. */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {titleHidden ? (
              <h1 className="sr-only">{title}</h1>
            ) : (
              // `title` exposes the full string once truncation kicks in.
              <h1
                title={title}
                className="truncate text-lg font-semibold tracking-tight text-foreground"
              >
                {title}
              </h1>
            )}
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
