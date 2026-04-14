"use client";

import React from "react";

import { useDivisionGrid } from "@/hooks/useCurrentWorkspace";
import UserAuraReporter from "@/app/(site)/users/components/UserAuraReporter";

interface UserHeaderAuraProps {
  avatarSrc: string;
  division: number;
}

const UserHeaderAura = ({ avatarSrc, division }: UserHeaderAuraProps) => {
  const grid = useDivisionGrid();
  const tier = grid.tiers.find((t) => t.number === division);
  const divisionIconSrc =
    tier?.icon_url ??
    `https://minio.craazzzyyfoxx.me/aqt/assets/divisions/default-${division}.png`;

  return <UserAuraReporter avatarSrc={avatarSrc} divisionIconSrc={divisionIconSrc} />;
};

export default UserHeaderAura;
