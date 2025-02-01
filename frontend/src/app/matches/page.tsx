"use client";

import React, { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import tournamentService from "@/services/tournament.service";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import encounterService from "@/services/encounter.service";
import {
  ColumnDef,
  getCoreRowModel,
  getPaginationRowModel, getSortedRowModel,
  PaginationState,
  SortingState,
  useReactTable
} from "@tanstack/react-table";
import { MapRead } from "@/types/map.types";
import Image from "next/image";
import { Match, Score } from "@/types/encounter.types";
import { PaginationWithLinks } from "@/components/ui/pagination-with-links";
import TableComponent from "@/components/TableComponent";
import { Skeleton } from "@/components/ui/skeleton";


const columns: ColumnDef<Match>[] = [
  {
    accessorKey: "map",
    header: "Map name",
    cell: ({ row }) => {
      const map: MapRead = row.getValue("map");
      return (
        <div className="relative h-[55px] min-w-[250px]">
          <div className="absolute inset-0 z-[1] bg-gradient-to-r from-transparent from-0% via-transparent to-card to-75%" />
          <Image
            className="h-full w-full min-w-[250px] brightness-75 z-0 relative"
            src={map.image_path}
            alt={map.name}
            style={{ objectFit: "cover" }}
            fill={true}
          />
          <h4 className="absolute bottom-0 left-0 m-2 text-xl p-1 font-semibold text-white">
            {map.name}
          </h4>
        </div>
      );
    }
  },
  {
    accessorKey: "tournament",
    header: () => <div>Tournament</div>,
    cell: ({ row }) => {
      return <div className="font-medium p-1 pl-2">{row.original.encounter?.tournament.name}</div>;
    }
  },
  {
    accessorKey: "Group",
    header: () => <div>Group</div>,
    cell: ({ row }) => {
      return <div className="font-medium p-1 pl-2">{row.original.encounter?.tournament_group.name}</div>;
    }
  },
  {
    accessorKey: "name",
    header: () => <div>Name</div>,
    cell: ({ row }) => {
      return <div className="font-medium p-1 pl-2">{`${row.original.home_team?.name } - ${row.original.away_team?.name }`}</div>;
    }
  },
  {
    accessorKey: "score",
    header: "Score",
    cell: ({ row }) => {
      const score: Score = row.getValue("score");
      return (
        <div className="p-1 pl-2">
          {score.home}-{score.away}
        </div>
      );
    }
  },
];


const MatchesPage = () => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [activeTournamentId, setActiveTournamentId] = useState<number | null>(null);
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10
  });

  const { data: tournamentsData } = useQuery({
    queryKey: ["tournaments"],
    queryFn: () => tournamentService.getAll()
  });
  const { data: matchesData, isLoading: isLoadingMatches } = useQuery({
    queryKey: ["matches", pagination.pageIndex],
    queryFn: () => encounterService.getAllMatches(pagination.pageIndex + 1, pagination.pageSize, ""),
  });


  const table = useReactTable({
    data: matchesData?.results || [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    rowCount: matchesData?.total || 0,
    onSortingChange: setSorting,
    state: {
      sorting,
      pagination
    },
    manualPagination: true
  });

  useEffect(() => {
    const newSearchParams = new URLSearchParams(searchParams);
    setPagination((prev) => ({
      ...prev,
      pageIndex: Number(newSearchParams.get("page")) - 1 || 0
    }));
    if (!newSearchParams.has("page")) {
      newSearchParams.set("page", "1");
      router.push(`${pathname}?${newSearchParams.toString()}`);
    }
  }, [pathname, router, searchParams]);

  const pushTournamentId = (newTournamentId: string) => {
    if (!searchParams) return `${pathname}?$tournamentId=${newTournamentId}`;
    const newSearchParams = new URLSearchParams(searchParams);
    newSearchParams.set("tournamentId", String(newTournamentId));
    router.push(`${pathname}?${newSearchParams.toString()}`);
    setActiveTournamentId(Number(newTournamentId));
  };

  return (
    <div className="flex min-w-full min-h-full flex-col gap-8">
      <div>
        <Select
          value={activeTournamentId?.toString()}
          onValueChange={(value) => pushTournamentId(value)}
        >
          <SelectTrigger className="w-[250px]">
            <SelectValue placeholder="Select a tournemnt" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {tournamentsData?.results.map((item) => (
                <SelectItem key={item.id} value={item.id.toString()}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      {
        isLoadingMatches ? (
          <Skeleton className="flex w-full h-[600px]"/>
        ) : (
          <div className="flex flex-col gap-8">
            <div className="rounded-md border">
              <TableComponent
                table={table}
                columns={columns}
                rowOnClick={(row) => router.push(`/matches/${row.original.id}`)}
                tableCellClassName={"p-0"}
              />
            </div>
            <div className="flex items-center justify-end space-x-2 py-4">
              <PaginationWithLinks
                page={pagination.pageIndex + 1}
                totalCount={matchesData?.total || 0}
                pageSize={pagination.pageSize}
              />
            </div>
          </div>
        )
      }
    </div>

  );
};

export default MatchesPage;