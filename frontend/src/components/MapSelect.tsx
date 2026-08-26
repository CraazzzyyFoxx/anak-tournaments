"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { LookupItem } from "@/types/pagination.types";

const SIZE_CLASS = {
  sm: "h-8 w-[160px] rounded-lg border-[color:var(--aqt-border-2)] bg-black/15 text-[12.5px]",
  lg: "h-[38px] w-[170px] rounded-lg border-[color:var(--aqt-border)] bg-white/[0.015] text-[13px]",
} as const;

type MapSelectProps = {
  /** The OW map catalogue. */
  maps: LookupItem[];
  mapId: number | null;
  onMapIdChange: (mapId: number | null) => void;
  /** "sm" matches inline panel controls, "lg" matches call-out/board screens. */
  size?: keyof typeof SIZE_CLASS;
};

/**
 * The optional map picker behind a "record result" control — "No map" plus
 * the OW catalogue. Shared so every recording surface (the mix panel, the
 * fullscreen lobby board, …) stays in lockstep instead of drifting as
 * separate copies of the same dropdown.
 */
export function MapSelect({ maps, mapId, onMapIdChange, size = "sm" }: Readonly<MapSelectProps>) {
  return (
    <Select
      value={mapId == null ? "none" : String(mapId)}
      onValueChange={(value) => onMapIdChange(value === "none" ? null : Number(value))}
    >
      <SelectTrigger className={SIZE_CLASS[size]}>
        <SelectValue placeholder="Map (optional)" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">No map</SelectItem>
        {maps.map((map) => (
          <SelectItem key={map.id} value={String(map.id)}>
            {map.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
