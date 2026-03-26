'use client';

import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { useState } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface DataTableProps<TData> {
  columns: ColumnDef<TData>[];
  data: TData[];
  /** Called when user reaches bottom; omit to disable infinite scroll */
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoading?: boolean;
  /** Caption for screen readers */
  caption?: string;
}

export function DataTable<TData>({
  columns,
  data,
  onLoadMore,
  hasMore,
  isLoading,
  caption,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);

  // TanStack Table is not yet React Compiler compatible.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="w-full">
      {/* Desktop: table layout */}
      <div className="hidden overflow-auto rounded-md border border-border md:block">
        <table className="w-full text-sm">
          {caption && (
            <caption className="sr-only">{caption}</caption>
          )}
          <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-border">
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"
                    style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                  >
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <button
                        type="button"
                        className="flex items-center gap-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={header.column.getToggleSortingHandler()}
                        aria-label={`${flexRender(header.column.columnDef.header, header.getContext())} で並び替え`}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getIsSorted() === 'asc' ? (
                          <ChevronUp className="h-3 w-3" aria-hidden="true" />
                        ) : header.column.getIsSorted() === 'desc' ? (
                          <ChevronDown className="h-3 w-3" aria-hidden="true" />
                        ) : (
                          <ChevronsUpDown className="h-3 w-3 opacity-40" aria-hidden="true" />
                        )}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-12 text-center text-sm text-muted-foreground"
                >
                  データがありません
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row, i) => (
                <tr
                  key={row.id}
                  className={cn(
                    'border-b border-border transition-colors last:border-0 hover:bg-muted/40',
                    i % 2 === 1 && 'bg-muted/20'
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 text-sm text-foreground">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile: card list layout */}
      <div className="space-y-2 md:hidden">
        {table.getRowModel().rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            データがありません
          </p>
        ) : (
          table.getRowModel().rows.map((row) => (
            <div
              key={row.id}
              className="rounded-md border border-border bg-card p-4 shadow-sm"
            >
              {row.getVisibleCells().map((cell) => {
                const header = table
                  .getHeaderGroups()[0]
                  ?.headers.find((h) => h.id === cell.column.id);
                return (
                  <div key={cell.id} className="flex items-start justify-between gap-2 py-1">
                    <span className="min-w-[6rem] text-xs font-medium text-muted-foreground">
                      {header
                        ? flexRender(header.column.columnDef.header, header.getContext())
                        : cell.column.id}
                    </span>
                    <span className="text-right text-sm text-foreground">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </span>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* Load more */}
      {hasMore && onLoadMore && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="outline"
            onClick={onLoadMore}
            disabled={isLoading}
            size="sm"
          >
            {isLoading ? '読み込み中...' : 'さらに表示'}
          </Button>
        </div>
      )}
    </div>
  );
}
