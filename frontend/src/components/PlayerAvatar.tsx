import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn, initials } from "@/lib/utils";

/** The minimum a surface needs to draw a player's identity. */
export interface PlayerIdentity {
  id: number;
  name: string;
  avatar_url: string | null;
}

/** A player's avatar, or their initials when there is none (or it fails to load). */
export function PlayerAvatar({
  user,
  size = 32,
  className
}: Readonly<{ user: PlayerIdentity; size?: number; className?: string }>) {
  return (
    <Avatar className={cn("shrink-0 border border-[color:var(--aqt-border)]", className)} style={{ width: size, height: size }}>
      {user.avatar_url ? <AvatarImage src={user.avatar_url} alt="" /> : null}
      <AvatarFallback className="bg-[color:var(--aqt-overlay-3)] text-label font-bold text-[color:var(--aqt-fg-muted)]">
        {initials(user.name)}
      </AvatarFallback>
    </Avatar>
  );
}
