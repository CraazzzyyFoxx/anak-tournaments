export interface Gamemode {
  id: number;
  created_at: Date;
  updated_at: Date | null;
  name: string;
  image_path: string;
  slug: string;
  description: string;
}
