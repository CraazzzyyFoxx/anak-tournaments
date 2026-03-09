import React from "react";
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
import { PlayerStatistics } from "@/types/statistics.types";

export interface TopWinratePlayersTableProps {
  players: PlayerStatistics[];
}

export default function TopWinratePlayersTable({ players }: TopWinratePlayersTableProps) {
  const percentFormatter = new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 1
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top Players by Win ratio</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[100px]">Player</TableHead>
              <TableHead className="text-center">Win ratio</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {players.length === 0 ? (
              <TableRow>
                <TableCell colSpan={2} className="text-muted-foreground">
                  No data
                </TableCell>
              </TableRow>
            ) : (
              players.map((player) => (
                <TableRow key={player.id}>
                  <TableCell className="font-medium">
                    <Link href={`/users/${player.name.replace("#", "-")}`}>{player.name}</Link>
                  </TableCell>
                  <TableCell className="text-center">
                    {Number.isFinite(player.value)
                      ? percentFormatter.format(player.value)
                      : "-"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
