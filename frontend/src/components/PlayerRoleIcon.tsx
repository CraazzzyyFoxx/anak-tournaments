"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import FlexIcon from "@/components/icons/FlexIcon";
import { useRoleName } from "@/hooks/useRoleName";
import { findRole, ratedDimension, rolePresentation, showsRoles, type RoleOntology } from "@/lib/roster/ontology";
import type { RoleRef } from "@/lib/roster/team-format";

/** The dictionary is explicit owner scope. Missing/unknown history is never reclassified. */
export default function PlayerRoleIcon({
  role, ontology, size = 24, color, decorative, label, "aria-hidden": ariaHidden
}: Readonly<{
  role: RoleRef | string | null;
  ontology?: RoleOntology | null;
  size?: number;
  color?: string;
  decorative?: boolean;
  label?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>) {
  const t = useTranslations();
  const nameOf = useRoleName();
  const [failedIcon, setFailedIcon] = useState<string | null>(null);
  const open = role === null || (typeof role === "string" && role.toLowerCase() === "flex");
  // A game with one rated role names no role anywhere (the single-role rule), so its role has no glyph either.
  if (ontology && !open && !showsRoles(ontology)) return null;
  const ref = typeof role === "string"
    ? { dimension: ontology ? ratedDimension(ontology)?.code ?? "" : "", role }
    : role;
  const node = ontology ? findRole(ontology, ref) : null;
  const retired = node && (!node.active || !ontology?.dimensions.some(d => d.code === node.dimension && d.active));
  const name = open ? t("common.roles.flex") : node ? nameOf(node) : ref?.role ?? "";
  const accessibleName = label ?? (open ? name : retired
    ? t("common.roleOntology.retired", { role: name })
    : node ? name : t("common.roleOntology.unknown", { role: name }));
  const presentation = node && ontology ? rolePresentation(ontology.roles, node.id) : { icon: null, color: null };
  const hidden = decorative === true || ariaHidden === true || ariaHidden === "true";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center${retired ? " opacity-50" : ""}`}
      role={hidden ? undefined : "img"}
      aria-hidden={hidden || undefined}
      aria-label={hidden ? undefined : accessibleName}
      title={accessibleName}
      style={{ width: size, height: size, fontSize: size, color: node ? presentation.color ?? "var(--aqt-fg-muted)" : open ? color ?? "var(--aqt-fg-muted)" : "var(--aqt-fg-muted)" }}
    >
      {open ? <FlexIcon width={size} height={size} color="currentColor" /> : presentation.icon && failedIcon !== presentation.icon ? (
        <>
          {/* The same cached image detects failed artwork; masks themselves have no error event. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={presentation.icon} crossOrigin="anonymous" alt="" aria-hidden style={{ display: "none" }} onError={() => setFailedIcon(presentation.icon)} />
          <span aria-hidden style={{ width: size, height: size, backgroundColor: "currentColor", maskImage: `url("${presentation.icon}")`, WebkitMaskImage: `url("${presentation.icon}")`, maskSize: "contain", WebkitMaskSize: "contain", maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat", maskPosition: "center", WebkitMaskPosition: "center" }} />
        </>
      ) : <span aria-hidden className="text-[0.55em] font-medium">{node ? name.slice(0, 2).toUpperCase() : "?"}</span>}
    </span>
  );
}
