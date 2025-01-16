import React from "react";
import { API_URL } from "@/lib/interceptors";
import { PaginatedResponse } from "@/types/pagination.types";
import { PlayerStatistics } from "@/types/statistics.types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import Link from "next/link";

export default async function TopWonMapsPlayersTable() {
  const res = await fetch(`${API_URL}/statistics/player/won-maps`, { next: { revalidate: 60 } });
  const players: PaginatedResponse<PlayerStatistics> = await res.json();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Топ по выигранным картам</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[100px]">Игрок</TableHead>
              <TableHead className="text-center">Выиграно карт</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {players.results.map((champion) => (
              <TableRow key={champion.id}>
                <TableCell className="font-medium">
                  <Link href={`users/${champion.name.replace("#", "-")}`}>{champion.name}</Link>
                </TableCell>
                <TableCell className="text-center">{champion.value}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
