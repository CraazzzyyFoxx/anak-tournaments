import React from "react";
import Image from "next/image";
import { User, UserProfile } from "@/types/user.types";
import { getPlayerImage } from "@/utils/player";
import { cn } from "@/lib/utils";
import UserBattleTags from "@/app/(site)/users/components/UserBattleTags";
import UserAuraReporter from "@/app/(site)/users/components/UserAuraReporter";

export interface UserHeaderProps {
  profile: UserProfile;
  user: User;
}

const StatPill = ({ label, value }: { label: string; value: string }) => {
  return (
    <div className="rounded-xl border bg-background/20 px-3 py-2 sm:min-w-[160px]">
      <div className="text-xs font-semibold text-muted-foreground">{label}</div>
      <div className="text-xl font-bold leading-tight tabular-nums">{value}</div>
    </div>
  );
};

const TagChip = ({ children, className }: { children: React.ReactNode; className?: string }) => {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border bg-background/15 px-3 py-2 text-sm font-semibold text-muted-foreground",
        className
      )}
    >
      {children}
    </span>
  );
};

const formatNullableStat = (value: number | null, digits = 1, suffix = "") => {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }

  return `${value.toFixed(digits)}${suffix}`;
};

const UserHeader = ({ profile, user }: UserHeaderProps) => {
  const nameData = user.name.split("#");
  const name = nameData[0];
  const tag = nameData[1];

  const battle_tags: string[] = user.battle_tag.map((battleTag) => battleTag.battle_tag);

  const primaryRoleDivisionRaw = profile.roles.length
    ? profile.roles.reduce((best, current) => (current.tournaments > best.tournaments ? current : best))
        .division
    : 1;
  const primaryRoleDivision = Math.min(20, Math.max(1, primaryRoleDivisionRaw));
  const divisionIconSrc = `/divisions/${primaryRoleDivision}.png`;
  const avatarSrc = getPlayerImage(profile, user);

  const winrate = profile.maps_total > 0 ? (profile.maps_won / profile.maps_total) * 100 : null;

  return (
    <section className="liquid-glass-panel relative overflow-hidden rounded-2xl border p-4 md:p-6">
      <UserAuraReporter avatarSrc={avatarSrc} divisionIconSrc={divisionIconSrc} />
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute -top-24 -left-24 h-72 w-72 rounded-full blur-3xl"
          style={{ backgroundColor: "rgb(var(--lg-a) / 0.18)" }}
        />
        <div
          className="absolute -top-28 right-0 h-80 w-80 rounded-full blur-3xl"
          style={{ backgroundColor: "rgb(var(--lg-b) / 0.14)" }}
        />
        <div
          className="absolute -bottom-24 left-1/3 h-80 w-80 rounded-full blur-3xl"
          style={{ backgroundColor: "rgb(var(--lg-c) / 0.12)" }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background/35" />
      </div>

      <div className="relative flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-1 items-center gap-4 min-w-0">
          <div className="relative">
            <div
              className="absolute -inset-1 rounded-2xl blur"
              style={{
                backgroundImage:
                  "linear-gradient(135deg, rgb(var(--lg-a) / 0.35), rgb(var(--lg-b) / 0.25), rgb(var(--lg-c) / 0.30))"
              }}
            />
            <Image
              className="relative rounded-2xl aspect-square ring-1 ring-white/10"
              src={avatarSrc}
              width={96}
              height={96}
              alt={`${name} avatar`}
            />
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <h1 className="scroll-m-20 text-2xl font-semibold tracking-tight">{name}</h1>
              {tag ? (
                <span className="text-lg font-semibold tracking-tight text-muted-foreground">#{tag}</span>
              ) : null}
            </div>

            {battle_tags.length > 0 ? (
              <UserBattleTags tags={battle_tags} />
            ) : null}

            {(user.twitch.length > 0 || user.discord.length > 0 || user.battle_tag.length > 0) && (
              <div className="mt-3 flex flex-wrap gap-2 max-w-full">
                {user.twitch.length > 0 ? (
                  <TagChip className="text-foreground">
                    <Image src={"/twitch.png"} width={18} height={18} alt="Twitch" />
                    <span className="max-w-[260px] truncate" title={user.twitch[0].name}>
                      {user.twitch[0].name}
                    </span>
                  </TagChip>
                ) : null}
                {user.discord.length > 0 ? (
                  <TagChip className="text-foreground">
                    <Image src={"/discord.png"} width={18} height={18} alt="Discord" />
                    <span className="max-w-[260px] truncate" title={user.discord[0].name}>
                      {user.discord[0].name}
                    </span>
                  </TagChip>
                ) : null}
                {user.battle_tag.length > 0 ? (
                  <TagChip className="text-foreground">
                    <Image src={"/battlenet.svg"} width={18} height={18} alt="Battle.net" />
                    <span className="max-w-[260px] truncate" title={user.battle_tag[0].battle_tag}>
                      {user.battle_tag[0].battle_tag}
                    </span>
                  </TagChip>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <div className="grid w-full grid-cols-2 gap-2 md:w-auto md:self-start shrink-0">
          <StatPill label="Tournaments" value={`${profile.tournaments_count}`} />
          <StatPill label="Winrate" value={formatNullableStat(winrate, 1, "%")} />
          <StatPill label="Maps" value={`${profile.maps_won}/${profile.maps_total}`} />
          <StatPill label="Avg Place" value={formatNullableStat(profile.avg_placement)} />
        </div>
      </div>
    </section>
  );
};

export default UserHeader;
