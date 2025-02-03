import React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { ColumnDef, flexRender, Table as reactTable } from "@tanstack/react-table";

export interface TableComponentProps {
  table: reactTable<any>;
  columns: ColumnDef<any>[];
  rowOnClick?: (row: any) => void;
  tableCellClassName?: string;
}

const TableComponent = ({
  table,
  columns,
  rowOnClick,
  tableCellClassName
}: TableComponentProps) => {
  return (
    <Table>
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map((header) => {
              return (
                <TableHead key={header.id}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows?.length ? (
          table.getRowModel().rows.map((row) => (
            <TableRow
              key={row.id}
              data-state={row.getIsSelected() && "selected"}
              onClick={() => {
                if (rowOnClick) rowOnClick(row);
              }}
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell className={tableCellClassName} key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell colSpan={columns.length} className="h-24 text-center">
              No results.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
};

export default TableComponent;
