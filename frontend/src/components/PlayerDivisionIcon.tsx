import React from "react";
import Image from "next/image";


export interface PlayerDivisionIconProps {
  division: number;
  width?: number;
  height?: number;
}



const PlayerDivisionIcon = (data: PlayerDivisionIconProps) => {
  return (
    <div className="flex justify-center">
      <Image
        src={`/divisions/${data.division}.png`}
        alt="Division"
        width={data.width || 36}
        height={data.height || 36}
      />
    </div>
  );
};

export default PlayerDivisionIcon;