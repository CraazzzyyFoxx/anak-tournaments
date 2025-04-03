"use client"

import React, { useEffect } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useClerk, useUser, useOrganizationList, useOrganization } from "@clerk/nextjs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { User as UserIcon, LogOut, Building } from "lucide-react";
import { useRouter } from "next/navigation";
import { User } from "@/types/user.types";
import userService from "@/services/user.service";
import { getPlayerSlug } from "@/utils/player";
import Image from "next/image";

const UserMenu = () => {
  const { isSignedIn, user: clerkUser, isLoaded } = useUser()
  const [user, setUser] = React.useState<User | null>(null)
  const { push } = useRouter()
  const { signOut } = useClerk();
  const { organization } = useOrganization();
  const { setActive, userMemberships } = useOrganizationList({
    userMemberships: {
      pageSize: 5,
      keepPreviousData: true,
    },
  })

  useEffect(() => {
    if (isSignedIn && isLoaded) {
      // @ts-ignore
      userService.getUserByName(clerkUser.username).then((data) => {setUser(data)})
    }
  }, [isLoaded, isSignedIn]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Avatar className="h-8 w-8 aspect-square">
          <AvatarImage src={clerkUser?.imageUrl} asChild>
            <Image src={clerkUser?.imageUrl || ""} alt="@avatar" width={24} height={24} />
          </AvatarImage>
          <AvatarFallback>{clerkUser?.username}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>{user?.name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => push(`/users/${getPlayerSlug(user?.name)}`)}>
            <UserIcon />
            <span>Profile</span>
          </DropdownMenuItem>
          {
            (userMemberships.count || 0) > 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Building />
                  <span>
                {organization?.name ? organization.name : "Personal Account"}
              </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onClick={() => setActive ? setActive({ organization: null }) : null}>
                      <Building />
                      <span>Personal Account</span>
                    </DropdownMenuItem>
                    {
                      clerkUser?.organizationMemberships.map((membership) => (
                        <DropdownMenuItem
                          key={membership.id}
                          onClick={() => setActive ? setActive({ organization: membership.organization.id }) : null}
                        >
                          <Building />
                          <span>{membership.organization.name}</span>
                        </DropdownMenuItem>
                      ))
                    }
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
            )
          }
          <DropdownMenuItem onClick={() => signOut()}>
            <LogOut />
            <span>Logout</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default UserMenu;