import React from "react";
import Image from "next/image";
import { User, UserProfile } from "@/types/user.types";
import { getPlayerImage } from "@/utils/player";

export interface UserHeaderProps {
  profile: UserProfile;
  user: User;
}

const UserHeader = ({ profile, user }: UserHeaderProps) => {
  const nameData = user.name.split("#");
  const name = nameData[0];
  const tag = nameData[1];

  const battle_tags: string[] = user.battle_tag.map((battleTag) => battleTag.battle_tag);

  return (
    <div className="lg:ml-5 flex flex-row gap-4 items-center">
      <Image
        className="rounded-xl aspect-square"
        src={getPlayerImage(profile, user)}
        width={90}
        height={90}
        alt="Avatar"
      />
      <div className="flex flex-col">
        <div className="flex flex-row gap-1">
          <h3 className="scroll-m-20 xs:text-lg xs1:text-2xl font-semibold tracking-tight">
            {name}
          </h3>
          <h3 className="hidden scroll-m-20 xs:text-lg xs1:text-2xl xs1:block font-semibold tracking-tight text-muted-foreground">
            {`#${tag}`}
          </h3>
        </div>
        <div className="flex gap-2">
          <p className="text-muted-foreground text-sm">{battle_tags.join(" ")}</p>
        </div>
        <div className="pt-1 flex xs1:flex-row xs:flex-col xs1:gap-4">
          <div className="flex flex-row gap-2">
            <div>
              <Image src={"/twitch.png"} width={28} height={28} alt="Twitch" />
            </div>
            <p className="leading-7">{user.twitch[0].name}</p>
          </div>
          {user.discord.length > 0 ? (
            <div className="flex flex-row gap-2">
              <div>
                <Image src={"/discord.png"} width={28} height={28} alt="Discord" />
              </div>
              <p className="leading-7">{user.discord[0].name}</p>
            </div>
          ) : (
            <></>
          )}
        </div>
      </div>
    </div>
  );
};

export default UserHeader;
