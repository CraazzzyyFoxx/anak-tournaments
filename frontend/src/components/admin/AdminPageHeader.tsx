import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface AdminPageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  eyebrow?: string;
  meta?: React.ReactNode;
}

export function AdminPageHeader({
  title,
  description,
  actions,
  eyebrow = "Admin Workspace",
  meta,
}: AdminPageHeaderProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="relative overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-br from-card via-card to-muted/30 p-5 shadow-sm sm:p-6">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/35 to-transparent" />
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                {eyebrow}
              </Badge>
              {meta}
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{title}</h1>
              {description ? (
                <p className="max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
                  {description}
                </p>
              ) : null}
            </div>
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2 lg:justify-end">{actions}</div> : null}
        </div>
      </div>
      <Separator />
    </div>
  );
}
