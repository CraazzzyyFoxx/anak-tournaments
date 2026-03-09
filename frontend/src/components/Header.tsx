"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { LogIn, Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from "@/components/ui/accordion";
import UserSearch from "@/components/UserSearch";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger
} from "@/components/ui/navigation-menu";
import { cn } from "@/lib/utils";
import { SITE_ICON, SITE_NAME } from "@/config/site";
import UserMenu from "@/components/UserMenu";
import { useAuthProfile } from "@/hooks/useAuthProfile";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuthModalStore } from "@/stores/auth-modal.store";

const tournament_components: { title: string; href: string; description: string }[] = [
  {
    title: "Tournaments",
    href: "/tournaments",
    description: "Place where all tournaments are listed"
  },
  {
    title: "Teams",
    href: "/teams",
    description: "Place where all teams are listed"
  },
  {
    title: "OWAL",
    href: "/owal",
    description: "Place where all OWAL tournaments are listed"
  },
  {
    title: "Analytics",
    href: "/tournaments/analytics",
    description: "Page with analytics for tournaments"
  }
];

const users_components: { title: string; href: string; description: string }[] = [
  {
    title: "Users",
    href: "/users",
    description: "Place where all users are listed"
  },
  {
    title: "Compare",
    href: "/users/compare",
    description: "Page where you can compare users"
  },
  {
    title: "Achievements",
    href: "/achievements",
    description: "Page where all achievements are listed"
  }
];

const matches_components: { title: string; href: string; description: string }[] = [
  {
    title: "Encounters",
    href: "/encounters",
    description: "Place where all encounters are listed"
  },
  {
    title: "Matches",
    href: "/matches",
    description: "Page where all matches are listed"
  }
];

const organizer_components: { title: string; href: string; description: string }[] = [
  {
    title: "Balancer",
    href: "/balancer",
    description: "Tool for balancing teams by player roles and ratings"
  }
];

const components: Record<string, { title: string; href: string; description: string }[]> = {
  Tournaments: tournament_components,
  Users: users_components,
  Matches: matches_components,
  Organizer: organizer_components
};

const Header = () => {
  const { user } = useAuthProfile();
  const openAuthModal = useAuthModalStore((state) => state.open);
  const { isOrganizer, isAdmin, isLoaded } = usePermissions();
  const username = user?.username;
  const avatarUrl = user?.avatarUrl;
  const profileHref = username ? `/users/${username}` : "/users";

  return (
    <header className="sticky top-0 z-50 flex h-14 items-center bg-background gap-4 border-b px-4 md:px-6">
      <Link href={"/"}>
        <Image src={SITE_ICON} alt={SITE_NAME} width={40} height={40} />
      </Link>
      <NavigationMenu className="hidden md:flex">
        {Object.keys(components)
          .filter((title) => title !== "Organizer" || (isLoaded && isOrganizer))
          .map((title) => (
            <NavigationMenuList key={title}>
              <NavigationMenuItem>
                <NavigationMenuTrigger>{title}</NavigationMenuTrigger>
                <NavigationMenuContent>
                  <ul className="grid w-[400px] gap-3 p-4 md:w-[500px] md:grid-cols-2 lg:w-[600px] ">
                    {components[title].map((component) => (
                      <ListItem key={component.title} title={component.title} href={component.href}>
                        {component.description}
                      </ListItem>
                    ))}
                  </ul>
                </NavigationMenuContent>
              </NavigationMenuItem>
            </NavigationMenuList>
          ))}
        {isLoaded && (isAdmin || isOrganizer) && (
          <NavigationMenuList>
            <NavigationMenuItem>
              <Link href="/admin" legacyBehavior passHref>
                <NavigationMenuLink className="group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50 data-[active]:bg-accent/50 data-[state=open]:bg-accent/50">
                  Admin
                </NavigationMenuLink>
              </Link>
            </NavigationMenuItem>
          </NavigationMenuList>
        )}
      </NavigationMenu>
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="outline" size="icon" className="shrink-0 md:hidden">
            <Menu className="h-5 w-5" />
            <span className="sr-only">Toggle navigation menu</span>
          </Button>
        </SheetTrigger>
        <SheetContent side="left">
          <nav className="grid gap-2 text-lg font-medium">
            <Link href="#" className="flex items-center gap-2 text-lg font-semibold mb-4">
              <Image src={SITE_ICON} alt={SITE_NAME} width={32} height={32} />
              <span className="sr-only">{SITE_NAME}</span>
            </Link>
            <Accordion type="single" collapsible className="w-full">
              {Object.entries(components)
                .filter(([category]) => category !== "Organizer" || (isLoaded && isOrganizer))
                .map(([category, items]) => (
                  <AccordionItem key={category} value={category}>
                    <AccordionTrigger className="text-base hover:text-foreground">
                      {category}
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="grid gap-4 pl-4">
                        {items.map((item) => (
                          <Link
                            key={item.title}
                            href={item.href}
                            className="text-muted-foreground hover:text-foreground text-sm"
                          >
                            {item.title}
                          </Link>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
            </Accordion>
            {isLoaded && (isAdmin || isOrganizer) && (
              <Link
                href="/admin"
                className="text-muted-foreground hover:text-foreground text-base mt-4 block"
              >
                Admin
              </Link>
            )}
          </nav>
        </SheetContent>
      </Sheet>
      <div className="flex w-full items-center md:ml-auto gap-4 lg:gap-4">
        <div className="ml-auto flex-1 sm:flex-initial">
          <UserSearch />
        </div>
        {username ? (
          <UserMenu username={username} avatarUrl={avatarUrl} profileHref={profileHref} />
        ) : (
          <Button variant="outline" className="text-base" onClick={() => openAuthModal()}>
            <LogIn className="h-5 w-5" />
            <span className="hidden sm:inline">Login</span>
          </Button>
        )}
      </div>
    </header>
  );
};

const ListItem = React.forwardRef<React.ElementRef<"a">, React.ComponentPropsWithoutRef<"a">>(
  ({ className, title, children, ...props }, ref) => {
    return (
      <li>
        <NavigationMenuLink asChild>
          <a
            ref={ref}
            className={cn(
              "block select-none space-y-1 rounded-md p-3 leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
              className
            )}
            {...props}
          >
            <div className="text-sm font-medium leading-none">{title}</div>
            <p className="line-clamp-2 text-sm leading-snug text-muted-foreground">{children}</p>
          </a>
        </NavigationMenuLink>
      </li>
    );
  }
);
ListItem.displayName = "ListItem";

export default Header;
