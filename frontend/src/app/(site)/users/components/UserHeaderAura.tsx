"use client";

import React from "react";

import { useDivisionGrid } from "@/hooks/useCurrentWorkspace";
import UserAuraReporter from "@/app/(site)/users/components/UserAuraReporter";
import { getDivisionIconSrc } from "@/lib/division-grid";
import type { DivisionGridVersion } from "@/types/workspace.types";

interface UserHeaderAuraProps {
  avatarSrc: string;
  division: number;
  divisionGridVersion?: DivisionGridVersion | null;
}

const UserHeaderAura = ({ avatarSrc, division, divisionGridVersion }: UserHeaderAuraProps) => {
  const grid = useDivisionGrid();
  const divisionIconSrc = getDivisionIconSrc(divisionGridVersion ?? grid, division);

  return <UserAuraReporter avatarSrc={avatarSrc} divisionIconSrc={divisionIconSrc ?? ""} />;
};

export default UserHeaderAura;
