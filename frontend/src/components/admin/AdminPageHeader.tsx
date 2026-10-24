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
        {/* `grow basis-48`: the actions share the title's row while the title
            keeps 12rem, and drop to their own row below that — `flex-1` let them
            squeeze a phone's title down to one letter. `max-w-full` instead of
            `shrink-0` caps the actions at the row, so they wrap (or scroll, like
            the game tabs) inside it instead of spilling past the screen edge. */}
        <div className="min-w-0 grow basis-48">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {titleHidden ? (
              <h1 className="sr-only">{title}</h1>
            ) : (
              // `title` exposes the full string once truncation kicks in.
              <h1
                title={title}
                className="truncate text-lg font-semibold text-foreground"
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
        {actions && <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {footer}
    </div>
  );
}
