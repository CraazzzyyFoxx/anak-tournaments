import React from "react";
import Link from "next/link";
import Image from "next/image";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import UserSearch from "@/components/UserSearch";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import { cn } from "@/lib/utils";
import Github from "@/components/icons/Github";

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

const components: Record<string, { title: string; href: string; description: string }[]> = {
  Tournaments: tournament_components,
  Users: users_components,
  Matches: matches_components
};

const Header = () => {
  return (
    <header className="sticky top-0 z-50 flex h-14 items-center bg-background gap-4 border-b px-4 md:px-6">
      <Link href={"/"}>
        <Image src={"/logo.webp"} alt="AQT" width={40} height={40} />
      </Link>
      <NavigationMenu className="hidden md:flex">
        {Object.keys(components).map((title) => (
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
      </NavigationMenu>
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="outline" size="icon" className="shrink-0 md:hidden">
            <Menu className="h-5 w-5" />
            <span className="sr-only">Toggle navigation menu</span>
          </Button>
        </SheetTrigger>
        <SheetContent side="left">
          <nav className="grid gap-6 text-lg font-medium">
            <Link href="#" className="flex items-center gap-2 text-lg font-semibold">
              <Image src={"/logo.webp"} alt="Anak" width={32} height={32} />
              <span className="sr-only">Anakq Tournaments</span>
            </Link>
            <Link href="/users" className="hover:text-foreground">
              Players
            </Link>
            <Link href="/teams" className="text-muted-foreground hover:text-foreground">
              Teams
            </Link>
            <Link
              href="/encounters?search=&page=1"
              className="text-muted-foreground hover:text-foreground"
            >
              Matches
            </Link>
            <Link href="/statistics" className="text-muted-foreground hover:text-foreground">
              Logs
            </Link>
            <Link href="/owal" className="text-muted-foreground hover:text-foreground">
              OWAL
            </Link>
          </nav>
        </SheetContent>
      </Sheet>
      <div className="flex w-full items-center gap-4 md:ml-auto md:gap-2 lg:gap-4">
        <div className="ml-auto flex-1 sm:flex-initial">
          <UserSearch />
        </div>
        <Link href={"https://github.com/CraazzzyyFoxx/anak-tournaments"}>
          <Github />
        </Link>
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
