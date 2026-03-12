"use client";

import React from "react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

const UserProfileTabList = () => {
  return (
    <ScrollArea>
      <TabsList className="h-11 w-max rounded-full bg-muted/40 p-1 gap-1">
        <TabsTrigger
          value="overview"
          className="h-9 rounded-full px-4 data-[state=active]:bg-background/70 data-[state=active]:shadow-md"
        >
          Overview
        </TabsTrigger>
        <TabsTrigger
          value="tournaments"
          className="h-9 rounded-full px-4 data-[state=active]:bg-background/70 data-[state=active]:shadow-md"
        >
          Tournaments
        </TabsTrigger>
        <TabsTrigger
          value="matches"
          className="h-9 rounded-full px-4 data-[state=active]:bg-background/70 data-[state=active]:shadow-md"
        >
          Matches
        </TabsTrigger>
        <TabsTrigger
          value="heroes"
          className="h-9 rounded-full px-4 data-[state=active]:bg-background/70 data-[state=active]:shadow-md"
        >
          Heroes
        </TabsTrigger>
        <TabsTrigger
          value="maps"
          className="h-9 rounded-full px-4 data-[state=active]:bg-background/70 data-[state=active]:shadow-md"
        >
          Maps
        </TabsTrigger>
        <TabsTrigger
          value="achievements"
          className="h-9 rounded-full px-4 data-[state=active]:bg-background/70 data-[state=active]:shadow-md"
        >
          Achievements
        </TabsTrigger>
      </TabsList>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
};

export default UserProfileTabList;
