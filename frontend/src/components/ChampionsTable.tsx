import React from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { PlayerStatistics } from "@/types/statistics.types";

export interface ChampionsTableProps {
  champions: PlayerStatistics[];
}

export default function ChampionsTable({ champions }: ChampionsTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Champions</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[100px]">Players</TableHead>
              <TableHead className="text-center">Champs</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {champions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={2} className="text-muted-foreground">
                  No data
                </TableCell>
              </TableRow>
            ) : (
              champions.map((champion) => (
                <TableRow key={champion.id}>
                  <TableCell className="font-medium">
                    <Link href={`/users/${champion.name.replace("#", "-")}`}>{champion.name}</Link>
                  </TableCell>
                  <TableCell className="text-center">{champion.value}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
