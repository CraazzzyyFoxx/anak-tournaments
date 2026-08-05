export interface Gamemode {
  id: number;
  created_at: Date;
  updated_at: Date | null;
  name: string;
  image_path: string;
  slug: string;
  description: string;
  /** Names this gamemode appears under in match logs; maintained by hand. */
  aliases: string[];
}
