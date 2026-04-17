"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useDebounce } from "use-debounce";

import { useDivisionGrid } from "@/hooks/useCurrentWorkspace";
import { clampDivisionToGrid } from "@/lib/division-grid";
import userService from "@/services/user.service";
import { UserRoleType } from "@/types/user.types";
import { Card, CardContent } from "@/components/ui/card";

import UsersOverviewFilters from "./components/users-overview/UsersOverviewFilters";
import UsersOverviewTable from "./components/users-overview/UsersOverviewTable";
import {
  parseOptionalInt,
  parseOrderValue,
  parsePositiveInt,
  parseSortValue
} from "./components/users-overview/utils";

const UsersPageContent = () => {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const divisionGrid = useDivisionGrid();

  const page = parsePositiveInt(searchParams.get("page"), 1);
  const perPage = parsePositiveInt(searchParams.get("per_page"), 20);
  const query = searchParams.get("query") ?? "";
  const sort = parseSortValue(searchParams.get("sort"));
  const order = parseOrderValue(searchParams.get("order"));
  const role = (searchParams.get("role") as UserRoleType | null) ?? undefined;
  const divMin = clampDivisionToGrid(divisionGrid, parseOptionalInt(searchParams.get("div_min")));
  const divMax = clampDivisionToGrid(divisionGrid, parseOptionalInt(searchParams.get("div_max")));

  const [searchInput, setSearchInput] = useState(query);
  const [divMinInput, setDivMinInput] = useState(divMin ? String(divMin) : "");
  const [divMaxInput, setDivMaxInput] = useState(divMax ? String(divMax) : "");
  const [expandedRows, setExpandedRows] = useState<Set<number>>(() => new Set());

  const [debouncedSearchInput] = useDebounce(searchInput, 300);

  useEffect(() => {
    setSearchInput(query);
  }, [query]);

  useEffect(() => {
    setDivMinInput(divMin ? String(divMin) : "");
    setDivMaxInput(divMax ? String(divMax) : "");
  }, [divMin, divMax]);

  const updateParams = useCallback(
    (updates: Record<string, string | number | undefined>, keepPage = false): void => {
      const next = new URLSearchParams(searchParams.toString());

      Object.entries(updates).forEach(([key, value]) => {
        if (value === undefined || value === "") {
          next.delete(key);
          return;
        }
        next.set(key, String(value));
      });

      if (!keepPage) {
        next.set("page", "1");
      }

      router.replace(`${pathname}?${next.toString()}`);
    },
    [pathname, router, searchParams]
  );

  useEffect(() => {
    const normalizedInput = debouncedSearchInput.trim();
    const normalizedQuery = query.trim();
    if (normalizedInput === normalizedQuery) return;
    updateParams({ query: normalizedInput || undefined });
  }, [debouncedSearchInput, query, updateParams]);

  const { data, isLoading, isFetching, isError, error } = useQuery({
    queryKey: ["users-overview", page, perPage, query, sort, order, role, divMin, divMax],
    queryFn: () =>
      userService.getUsersOverview({
        page,
        perPage,
        sort,
        order,
        query: query || undefined,
        role,
        divMin,
        divMax
      }),
    placeholderData: (previousData) => previousData,
    staleTime: 30_000
  });

  const maxPage = useMemo(() => {
    if (!data || data.per_page <= 0) return 1;
    return Math.max(1, Math.ceil(data.total / data.per_page));
  }, [data]);

  const toggleRow = useCallback((id: number): void => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleRoleChange = useCallback(
    (value: "all" | UserRoleType) => {
      updateParams({ role: value === "all" ? undefined : value });
    },
    [updateParams]
  );

  const handleDivMinChange = useCallback(
    (value: string) => {
      const next = value === "all" ? "" : value;
      setDivMinInput(next);
      updateParams({
        div_min:
          value === "all"
            ? undefined
            : clampDivisionToGrid(divisionGrid, parseOptionalInt(value))
      });
    },
    [divisionGrid, updateParams]
  );

  const handleDivMaxChange = useCallback(
    (value: string) => {
      const next = value === "all" ? "" : value;
      setDivMaxInput(next);
      updateParams({
        div_max:
          value === "all"
            ? undefined
            : clampDivisionToGrid(divisionGrid, parseOptionalInt(value))
      });
    },
    [divisionGrid, updateParams]
  );

  const handleResetFilters = useCallback(() => {
    setSearchInput("");
    setDivMinInput("");
    setDivMaxInput("");
    updateParams({ query: undefined, role: undefined, div_min: undefined, div_max: undefined });
  }, [updateParams]);

  return (
    <div className="space-y-6">
      <div
        className="liquid-glass"
        style={
          {
            "--lg-a": "16 185 129",
            "--lg-b": "56 189 248",
            "--lg-c": "251 191 36"
          } as React.CSSProperties
        }
      >
        <UsersOverviewFilters
          searchInput={searchInput}
          role={role}
          divMinInput={divMinInput}
          divMaxInput={divMaxInput}
          sort={sort}
          order={order}
          onSearchChange={setSearchInput}
          onRoleChange={handleRoleChange}
          onDivMinChange={handleDivMinChange}
          onDivMaxChange={handleDivMaxChange}
          onSortChange={(value) => updateParams({ sort: value })}
          onOrderChange={(value) => updateParams({ order: value })}
          onReset={handleResetFilters}
        />
      </div>

      <div
        className="liquid-glass"
        style={
          {
            "--lg-a": "20 184 166",
            "--lg-b": "14 165 233",
            "--lg-c": "245 158 11"
          } as React.CSSProperties
        }
      >
        <Card>
          <CardContent className="pt-6">
            <UsersOverviewTable
              data={data}
              isLoading={isLoading}
              isError={isError}
              isFetching={isFetching}
              error={error}
              maxPage={maxPage}
              expandedRows={expandedRows}
              onToggleRow={toggleRow}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

const UsersPage = () => {
  return (
    <Suspense fallback={null}>
      <UsersPageContent />
    </Suspense>
  );
};

export default UsersPage;
