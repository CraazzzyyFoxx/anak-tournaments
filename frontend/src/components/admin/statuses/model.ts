import type { BalancerCustomStatus } from "@/types/balancer-admin.types";

/** `StatusMetaBadge` renders from the shared `StatusMeta` shape, which the
 *  catalog row nearly is: it carries no `value`, and its edit/delete grants are
 *  a property of the kind rather than of the row. */
export function badgeMeta(row: BalancerCustomStatus) {
  const isBuiltin = row.kind === "builtin";
  return {
    value: row.slug,
    scope: row.scope,
    is_builtin: isBuiltin,
    kind: row.kind,
    is_override: row.is_override,
    can_edit: true,
    can_delete: !isBuiltin,
    can_reset: isBuiltin && row.can_reset,
    icon_slug: row.icon_slug,
    icon_color: row.icon_color,
    name: row.name,
    description: row.description,
    excludes_from_balancer: row.excludes_from_balancer,
    excludes_from_ready: row.excludes_from_ready
  };
}
