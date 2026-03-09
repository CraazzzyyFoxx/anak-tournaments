"use client";

import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { OAUTH_PROVIDER_META } from "@/lib/oauth-providers";
import type { OAuthConnection, OAuthProviderName } from "@/types/auth.types";

type AccountConnectionCardProps = {
  provider: OAuthProviderName;
  connection: OAuthConnection | null;
  isUnlinking: boolean;
  onUnlink: (provider: OAuthProviderName) => void;
};

const AccountConnectionCard = ({
  provider,
  connection,
  isUnlinking,
  onUnlink
}: AccountConnectionCardProps) => {
  const meta = OAUTH_PROVIDER_META[provider];
  const displayName = connection?.display_name || connection?.username || "Connected";
  // Updated connectHref to keep modal open logic - setting next to /?settings=connections
  const connectHref = `/auth/${provider}/login?action=link&next=${encodeURIComponent("/?settings=connections")}`;

  return (
    <article 
      className="liquid-glass rounded-xl border p-4 transition-all duration-300 hover:shadow-lg hover:border-white/20"
      style={{
        "--lg-a": "236 72 153",
        "--lg-b": "168 85 247",
        "--lg-c": "99 102 241"
      } as React.CSSProperties}
    >
      <div className="flex items-start justify-between gap-4 relative z-10 w-full h-full">
        <div className="flex items-center gap-3 min-w-0">
          <div className="bg-background/50 p-2 rounded-full border border-border/50">
            <Image src={meta.icon} alt={meta.title} width={20} height={20} className={provider === 'battlenet' ? "invert grayscale" : ""} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground flex items-center gap-2">
              {meta.title}
              {connection && (
                <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
              )}
            </p>
            <p className="text-xs text-slate-300/80 truncate" title={displayName}>
              {connection ? displayName : "Not connected"}
            </p>
          </div>
        </div>

        {connection ? (
          <Button
            type="button"
            variant="destructive"
            className="bg-red-500/20 text-red-400 hover:bg-red-500/30 hover:text-red-300 border border-red-500/30 transition-all h-8 px-3 text-xs"
            disabled={isUnlinking}
            onClick={() => {
              const confirmed = window.confirm(`Disconnect ${meta.title} account?`);
              if (confirmed) {
                onUnlink(provider);
              }
            }}
          >
            {isUnlinking ? "..." : "Disconnect"}
          </Button>
        ) : (
          <Button 
            asChild 
            size="sm"
            className="bg-white/10 hover:bg-white/20 text-white border border-white/20 transition-all h-8 px-4 text-xs"
          >
            <Link href={connectHref}>Connect</Link>
          </Button>
        )}
      </div>
    </article>
  );
};

export default AccountConnectionCard;
