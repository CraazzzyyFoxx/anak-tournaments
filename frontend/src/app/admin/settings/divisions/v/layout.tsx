import type { ReactNode } from "react";

/**
 * The draft editor's shell — deliberately without the settings rail.
 *
 * The editor is three columns wide (ladder · views · impact); adding the T5
 * section nav next to them makes four, which is what the IA rejected (§9
 * "Меняем"). So the overview lives under the rail as a section and the editor
 * is a full-bleed route of its own.
 *
 * NOTE, and this is a real Next.js constraint rather than a preference: a
 * child layout cannot remove a parent one. `app/admin/settings/layout.tsx`
 * still wraps this subtree, so it is that layout — the one that owns the rail
 * — which has to render `children` bare for paths under
 * `/admin/settings/divisions/v/`. This file exists to be the full-screen
 * container once it does, and to be the single place that decision is
 * documented.
 */
export default function DivisionsEditorLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="min-w-0 flex-1">{children}</div>;
}
