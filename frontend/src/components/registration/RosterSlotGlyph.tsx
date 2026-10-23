"use client";

import { useTranslations } from "next-intl";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { ratedDimension, type RoleOntology } from "@/lib/roster/ontology";
import type { RoleRef } from "@/lib/roster/team-format";

/** `flex` is only the existing open-slot transport sentinel, never an ontology node. */
export default function RosterSlotGlyph({ code, role, ontology, size = 16, decorative = false }: Readonly<{
  code?: string | null;
  role?: RoleRef | null;
  ontology?: RoleOntology | null;
  size?: number;
  decorative?: boolean;
}>) {
  const t = useTranslations("common.roleOntology");
  if (!code && !role) return null;
  const open = !role && code === "flex";
  const ref = role ?? (code && !open ? { dimension: ontology ? ratedDimension(ontology)?.code ?? "" : "", role: code } : null);
  return <PlayerRoleIcon role={ref} ontology={ontology} size={size} label={open ? t("openSlot") : undefined} decorative={decorative} />;
}
