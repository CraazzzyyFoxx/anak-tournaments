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
import statisticsService from "@/services/statistics.service";

export default async function TopWinratePlayersTable() {
  const players = await statisticsService.getTopWinratePlayers();
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
            {players.results.map((champion) => (
              <TableRow key={champion.id}>
                <TableCell className="font-medium">
                  <Link href={`users/${champion.name.replace("#", "-")}`}>{champion.name}</Link>
                </TableCell>
                <TableCell className="text-center">{champion.value * 100}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
