"use client";

import React, { useCallback } from "react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

const UserProfileTabList = () => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const navToTab = useCallback(
    (tab: string) => {
      const newSearchParams = new URLSearchParams(searchParams || undefined);
      newSearchParams.set("tab", tab);
      router.push(`${pathname}?${newSearchParams.toString()}`);
    },
    [searchParams, pathname]
  );

  return (
    <ScrollArea className="mb-8">
      <TabsList className="grid w-[720px] grid-cols-6 mb-4">
        <TabsTrigger value="overview" onClick={() => navToTab("overview")}>
          Overview
        </TabsTrigger>
        <TabsTrigger value="tournaments" onClick={() => navToTab("tournaments")}>
          Tournaments
        </TabsTrigger>
        <TabsTrigger value="matches" onClick={() => navToTab("matches")}>
          Matches
        </TabsTrigger>
        <TabsTrigger value="heroes" onClick={() => navToTab("heroes")}>
          Heroes
        </TabsTrigger>
        <TabsTrigger value="maps" onClick={() => navToTab("maps")}>
          Maps
        </TabsTrigger>
        <TabsTrigger value="achievements" onClick={() => navToTab("achievements")}>
          Achievements
        </TabsTrigger>
      </TabsList>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
};

export default UserProfileTabList;
