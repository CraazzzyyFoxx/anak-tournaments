"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useDebounce } from "use-debounce";
import userService from "@/services/user.service";
import { SortDirection } from "@/types/pagination.types";
import { User } from "@/types/user.types";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList
} from "@/components/ui/command";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";

const UserSearch = () => {
  const [isOpen, setIsOpen] = React.useState<boolean>(false);
  const [searchData, setSearchData] = useState<User[]>([]);
  const [searchValue, setSearchValue] = useState<string>("");
  const [debouncedSearchValue] = useDebounce(searchValue, 300);
  const { push } = useRouter();

  useEffect(() => {
    userService
      .getAll({
        page: 1,
        per_page: 10,
        fields: ["name"],
        order: SortDirection.desc,
        sort: "similarity:name",
        query: debouncedSearchValue,
        entities: []
      })
      .then((r) => {
        setSearchData(r.results);
      });
  }, [debouncedSearchValue]);

  return (
    <div className="relative">
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverAnchor asChild>
          <div>
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              onFocus={() => setIsOpen(true)}
              onBlur={() => setIsOpen(false)}
              onClick={() => setIsOpen(true)}
              type="search"
              placeholder="Search users..."
              className="pl-8 sm:w-[300px] md:w-[200px] lg:w-[300px]"
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          className="sm:w-[300px] md:w-[200px] lg:w-[300px] p-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Command className="rounded-lg border shadow-md sm:w-[300px] md:w-[200px] lg:w-[300px]">
            <CommandList>
              <CommandEmpty>No results found.</CommandEmpty>
              <CommandGroup>
                {searchData.map((item) => (
                  <CommandItem
                    key={item.id}
                    onSelect={(value) => {
                      const formatedValue = value.replace("#", "-");
                      setSearchValue("");
                      push(`/users/${formatedValue}`);
                    }}
                  >
                    {item.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default UserSearch;
