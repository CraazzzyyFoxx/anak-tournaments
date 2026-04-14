import React from "react";

import DivisionIcon from "@/components/DivisionIcon";

export interface PlayerDivisionIconProps {
  division: number;
  width?: number;
  height?: number;
  className?: string;
}

const PlayerDivisionIcon = ({ division, width, height, className }: PlayerDivisionIconProps) => {
  return (
    <div className="flex justify-center">
      <DivisionIcon division={division} width={width} height={height} className={className} />
    </div>
  );
};

export default PlayerDivisionIcon;
