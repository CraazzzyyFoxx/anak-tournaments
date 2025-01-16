import React from "react";
import TankIcon from "@/components/icons/TankIcon";
import DamageIcon from "@/components/icons/DamageIcon";
import SupportIcon from "@/components/icons/SupportIcon";

const PlayerRoleIcon = ({ role }: { role: string }) => {
  return (
    <div>
      {role === "Tank" && <TankIcon />}
      {role === "Damage" && <DamageIcon />}
      {role === "Support" && <SupportIcon />}
    </div>
  );
};

export default PlayerRoleIcon;
