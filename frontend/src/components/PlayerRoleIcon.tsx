import React from "react";
import TankIcon from "@/components/icons/TankIcon";
import DamageIcon from "@/components/icons/DamageIcon";
import SupportIcon from "@/components/icons/SupportIcon";

const PlayerRoleIcon = ({ role, size = 24 }: { role: string; size?: number }) => {
  return (
    <div>
      {role === "Tank" && <TankIcon height={size} width={size} />}
      {role === "Damage" && <DamageIcon height={size} width={size} />}
      {role === "Support" && <SupportIcon height={size} width={size} />}
    </div>
  );
};

export default PlayerRoleIcon;
