"use client";

import React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import Link from "next/link";
import Image from "next/image";
import { LogOut, UserIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuthProfileStore } from "@/stores/auth-profile.store";

type UserMenuProps = {
  username: string;
  avatarUrl?: string | null;
  profileHref: string;
  logoutHref?: string;
};

const UserMenu = ({ username, avatarUrl, profileHref, logoutHref = "/auth/logout" }: UserMenuProps) => {
  const initials = username?.slice(0, 2).toUpperCase();
  const { push } = useRouter();
  const clearAuth = useAuthProfileStore((s) => s.clear);

  const handleLogout = () => {
    // Clear auth store before redirecting
    clearAuth();
    // Use window.location for full page navigation to ensure cookies are properly handled
    window.location.href = logoutHref;
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Avatar className="h-8 w-8 aspect-square">
          <AvatarImage src={avatarUrl ?? undefined} />
          <AvatarFallback>
            <Image src="/discord-white.svg" alt="Discord" width={16} height={16} />
            <span className="sr-only">{initials}</span>
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>{username}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => push(`/users/${username}`)}>
            <UserIcon />
            <span>Profile</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleLogout}>
            <LogOut />
            <span>Logout</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default UserMenu;
