import React from "react";
import Image from "next/image";

export interface PlayerDivisionIconProps {
  division: number;
  width?: number;
  height?: number;
  iconPath?: string;
}

const PlayerDivisionIcon = (data: PlayerDivisionIconProps) => {
  const src = data.iconPath ?? `/divisions/${data.division}.png`;

  return (
    <div className="flex justify-center">
      <Image
        src={src}
        alt={`Division ${data.division}`}
        width={data.width || 36}
        height={data.height || 36}
      />
    </div>
  );
};

export default PlayerDivisionIcon;
