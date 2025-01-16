import { Gamemode } from "@/types/gamemode.types";

export interface MapRead {
  id: number;
  created_at: Date;
  updated_at: Date | null;
  name: string;
  image_path: string;
  gamemode_id: number;

  gamemode: Gamemode;
}
