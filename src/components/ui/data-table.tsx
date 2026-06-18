'use client';

import {
  type ColumnFiltersState,
  type ColumnDef,
  type ExpandedState,
  type Row,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Columns3,
  Download,
  Printer,
  Search,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { LoadingButton } from '@/components/ui/loading-button';
import { Skeleton, SkeletonRows } from '@/components/ui/loading';
import { cn } from '@/lib/utils';

export type DataTableColumnMeta<TData> = {
  label?: string;
  mobileLabel?: string;
  mobileHidden?: boolean;
  tabletHidden?: boolean;
  exportValue?: (row: TData) => string;
};

type DataTableToolbarOptions = {
  enableGlobalFilter?: boolean;
  globalFilterPlaceholder?: string;
  enableColumnVisibility?: boolean;
  enableExport?: boolean;
  enablePrint?: boolean;
  exportFileName?: string;
  filterFields?: Array<{
    columnId: string;
    label: string;
    placeholder?: string;
  }>;
};

interface DataTableProps<TData> {
  columns: ColumnDef<TData>[];
  data: TData[];
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoading?: boolean;
  caption?: string;
  selectedRowIndex?: number;
  onRowClick?: (index: number) => void;
  enableRowSelection?: boolean;
  onSelectionChange?: (rows: TData[]) => void;
  getRowId?: (originalRow: TData, index: number, parent?: Row<TData>) => string;
  renderExpandedRow?: (row: Row<TData>) => React.ReactNode;
  toolbar?: DataTableToolbarOptions;
  emptyMessage?: string;
  errorMessage?: string;
  errorActionLabel?: string;
  onRetry?: () => void;
}

function getColumnMeta<TData>(column: ColumnDef<TData>): DataTableColumnMeta<TData> | undefined {
  return column.meta as DataTableColumnMeta<TData> | undefined;
}

function getColumnLabel<TData>(column: ColumnDef<TData>, fallbackId: string) {
  const meta = getColumnMeta(column);
  if (meta?.label) {
    return meta.label;
  }

  if (typeof column.header === 'string') {
    return column.header;
  }

  return fallbackId;
}

function stringifyExportValue(value: unknown) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

function toCsvRow(values: string[]) {
  return values.map((value) => `"${value.replace(/"/g, '""')}"`).join(',');
}

export function DataTable<TData>({
  columns,
  data,
  onLoadMore,
  hasMore,
  isLoading,
  caption,
  selectedRowIndex,
  onRowClick,
  enableRowSelection,
  onSelectionChange,
  getRowId,
  renderExpandedRow,
  toolbar,
  emptyMessage = 'データがありません',
  errorMessage,
  errorActionLabel = '再読み込み',
  onRetry,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [globalFilter, setGlobalFilter] = useState('');
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const effectiveColumns = useMemo<ColumnDef<TData>[]>(() => {
    const leadingColumns: ColumnDef<TData>[] = [];

    if (enableRowSelection) {
      leadingColumns.push({
        id: '__select',
        header: ({ table }) => (
          <div className="flex items-center justify-center">
            <Checkbox
              checked={table.getIsAllPageRowsSelected()}
              onCheckedChange={(checked) => table.toggleAllPageRowsSelected(Boolean(checked))}
              aria-label="表示中の行をすべて選択"
            />
          </div>
        ),
        cell: ({ row }) => (
          <div className="flex items-center justify-center">
            <Checkbox
              checked={row.getIsSelected()}
              onCheckedChange={(checked) => row.toggleSelected(Boolean(checked))}
              aria-label={`${row.id} を選択`}
              onClick={(event) => event.stopPropagation()}
            />
          </div>
        ),
        enableSorting: false,
        enableHiding: false,
        enableResizing: false,
        size: 52,
      });
    }

    if (renderExpandedRow) {
      leadingColumns.push({
        id: '__expand',
        header: () => <span className="sr-only">展開</span>,
        cell: ({ row }) => (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-11 sm:size-7"
            onClick={(event) => {
              event.stopPropagation();
              row.toggleExpanded();
            }}
            aria-label={row.getIsExpanded() ? '詳細を閉じる' : '詳細を開く'}
          >
            <ChevronDown
              className={cn('size-4 transition-transform', row.getIsExpanded() && 'rotate-180')}
              aria-hidden="true"
            />
          </Button>
        ),
        enableSorting: false,
        enableHiding: false,
        enableResizing: false,
        size: 52,
      });
    }

    return [...leadingColumns, ...columns];
  }, [columns, enableRowSelection, renderExpandedRow]);

  // TanStack Table is not yet React Compiler compatible.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns: effectiveColumns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      expanded,
      globalFilter,
      columnFilters,
    },
    enableRowSelection,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    getRowId,
    getRowCanExpand: () => Boolean(renderExpandedRow),
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onExpandedChange: setExpanded,
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  });

  const latestSelectionChangeRef = useRef(onSelectionChange);
  const notifiedSelectionRef = useRef<string | null>(null);

  useEffect(() => {
    latestSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  useEffect(() => {
    if (!latestSelectionChangeRef.current) return;
    const selectedRows = table.getSelectedRowModel().rows.map((row) => row.original);
    const selectionSignature = table
      .getSelectedRowModel()
      .rows.map((row) => row.id)
      .join('|');
    if (notifiedSelectionRef.current === selectionSignature) return;

    notifiedSelectionRef.current = selectionSignature;
    latestSelectionChangeRef.current(selectedRows);
  }, [rowSelection, table]);

  const showLoadingSkeleton = Boolean(isLoading && data.length === 0);
  const visibleLeafColumns = table
    .getVisibleLeafColumns()
    .filter((column) => !column.id.startsWith('__'));
  const selectedCount = table.getSelectedRowModel().rows.length;

  function handleExport() {
    const headers = visibleLeafColumns.map((column) => getColumnLabel(column.columnDef, column.id));
    const rows = table.getRowModel().rows.map((row) =>
      visibleLeafColumns.map((column) => {
        const meta = getColumnMeta(column.columnDef);
        const value = meta?.exportValue ? meta.exportValue(row.original) : row.getValue(column.id);
        return stringifyExportValue(value);
      }),
    );

    const csv = [toCsvRow(headers), ...rows.map((row) => toCsvRow(row))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = toolbar?.exportFileName ?? 'table-export.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  }

  function renderDesktopHeader() {
    return (
      <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
        {table.getHeaderGroups().map((headerGroup) => (
          <tr key={headerGroup.id} className="border-b border-border">
            {headerGroup.headers.map((header) => {
              const meta = getColumnMeta(header.column.columnDef);
              const isSpecial = header.column.id.startsWith('__');
              return (
                <th
                  key={header.id}
                  className={cn(
                    'relative px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground',
                    meta?.tabletHidden && 'hidden xl:table-cell',
                  )}
                  {...(header.getSize() !== 150
                    ? ({ width: String(header.getSize()) } as unknown as Record<string, string>)
                    : {})}
                >
                  {header.isPlaceholder ? null : header.column.getCanSort() ? (
                    <button
                      type="button"
                      className={cn(
                        'flex items-center gap-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        isSpecial && 'sr-only',
                      )}
                      onClick={header.column.getToggleSortingHandler()}
                      aria-label={`${getColumnLabel(header.column.columnDef, header.column.id)} で並び替え`}
                    >
                      {isSpecial
                        ? getColumnLabel(header.column.columnDef, header.column.id)
                        : flexRender(header.column.columnDef.header, header.getContext())}
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
                  {header.column.getCanResize() && !isSpecial && (
                    <div
                      onDoubleClick={() => header.column.resetSize()}
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      className="absolute top-0 right-0 h-full w-2 cursor-col-resize touch-none select-none"
                      aria-hidden="true"
                    />
                  )}
                </th>
              );
            })}
          </tr>
        ))}
      </thead>
    );
  }

  return (
    <div className="w-full space-y-3">
      {toolbar && (
        <div className="flex flex-col gap-3 rounded-md border border-border/60 bg-muted/20 p-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-1 flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
            {toolbar.enableGlobalFilter && (
              <div className="relative min-w-[220px] flex-1 md:max-w-sm">
                <Search
                  className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  value={globalFilter}
                  onChange={(event) => setGlobalFilter(event.target.value)}
                  placeholder={toolbar.globalFilterPlaceholder ?? 'テーブル内を絞り込み'}
                  className="min-h-[44px] pl-8 sm:h-8 sm:min-h-0"
                  aria-label={toolbar.globalFilterPlaceholder ?? 'テーブル内検索'}
                />
              </div>
            )}
            {toolbar.filterFields?.map((field) => (
              <div key={field.columnId} className="min-w-[180px] md:max-w-xs">
                <Input
                  value={(table.getColumn(field.columnId)?.getFilterValue() as string) ?? ''}
                  onChange={(event) =>
                    table.getColumn(field.columnId)?.setFilterValue(event.target.value)
                  }
                  placeholder={field.placeholder ?? `${field.label}で絞り込み`}
                  className="min-h-[44px] sm:h-8 sm:min-h-0"
                  aria-label={field.label}
                />
              </div>
            ))}
            {enableRowSelection && selectedCount > 0 && (
              <p className="text-sm text-muted-foreground">{selectedCount} 件を選択中</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {toolbar.enableColumnVisibility && visibleLeafColumns.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="outline" size="sm" className="min-h-[44px] sm:min-h-0" />
                  }
                >
                  <Columns3 className="mr-1.5 size-3.5" aria-hidden="true" />列
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>表示する列</DropdownMenuLabel>
                  {table
                    .getAllLeafColumns()
                    .filter((column) => !column.id.startsWith('__') && column.getCanHide())
                    .map((column) => (
                      <DropdownMenuCheckboxItem
                        key={column.id}
                        checked={column.getIsVisible()}
                        onCheckedChange={(checked) => column.toggleVisibility(Boolean(checked))}
                      >
                        {getColumnLabel(column.columnDef, column.id)}
                      </DropdownMenuCheckboxItem>
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {toolbar.enableExport && (
              <Button
                size="sm"
                variant="outline"
                className="min-h-[44px] sm:min-h-0"
                onClick={handleExport}
              >
                <Download className="mr-1.5 size-3.5" aria-hidden="true" />
                CSV出力
              </Button>
            )}
            {toolbar.enablePrint && (
              <Button
                size="sm"
                variant="outline"
                className="min-h-[44px] sm:min-h-0"
                onClick={() => window.print()}
              >
                <Printer className="mr-1.5 size-3.5" aria-hidden="true" />
                印刷
              </Button>
            )}
          </div>
        </div>
      )}

      {errorMessage ? (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex min-w-0 items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p className="min-w-0 break-words">{errorMessage}</p>
          </div>
          {onRetry ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-[44px] border-destructive/40 text-destructive hover:bg-destructive/10 sm:min-h-0"
              onClick={onRetry}
            >
              {errorActionLabel}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="hidden overflow-auto rounded-md border border-border md:block">
        {showLoadingSkeleton ? (
          <div className="p-4">
            <SkeletonRows rows={6} cols={Math.max(effectiveColumns.length, 3)} />
          </div>
        ) : (
          <table className="w-full text-sm">
            {caption && <caption className="sr-only">{caption}</caption>}
            {renderDesktopHeader()}
            <tbody>
              {table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={table.getVisibleLeafColumns().length}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row, index) => (
                  <Fragment key={row.id}>
                    <tr
                      className={cn(
                        'border-b border-border transition-colors last:border-0 hover:bg-muted/40',
                        index % 2 === 1 && 'bg-muted/20',
                        selectedRowIndex === index &&
                          'ring-2 ring-inset ring-primary/50 bg-primary/5',
                        row.getIsSelected() && 'bg-primary/5',
                      )}
                      onClick={() => onRowClick?.(index)}
                      onKeyDown={(event) => {
                        if (!onRowClick) return;
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onRowClick(index);
                        }
                      }}
                      role={onRowClick ? 'button' : undefined}
                      tabIndex={onRowClick ? 0 : undefined}
                    >
                      {row.getVisibleCells().map((cell) => {
                        const meta = getColumnMeta(cell.column.columnDef);
                        return (
                          <td
                            key={cell.id}
                            className={cn(
                              'px-4 py-3 text-sm text-foreground',
                              meta?.tabletHidden && 'hidden xl:table-cell',
                            )}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        );
                      })}
                    </tr>
                    {renderExpandedRow && row.getIsExpanded() && (
                      <tr className="border-b border-border bg-muted/10">
                        <td colSpan={table.getVisibleLeafColumns().length} className="px-4 py-4">
                          {renderExpandedRow(row)}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      <div className="space-y-2 md:hidden">
        {showLoadingSkeleton ? (
          Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="rounded-md border border-border bg-card p-4 shadow-sm">
              <div className="space-y-3">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            </div>
          ))
        ) : table.getRowModel().rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{emptyMessage}</p>
        ) : (
          table.getRowModel().rows.map((row) => {
            const visibleCells = row
              .getVisibleCells()
              .filter((cell) => !cell.column.id.startsWith('__'))
              .filter((cell) => !getColumnMeta(cell.column.columnDef)?.mobileHidden);

            return (
              <div
                key={row.id}
                className={cn(
                  'rounded-md border border-border bg-card p-4 shadow-sm',
                  onRowClick && 'cursor-pointer transition-colors hover:bg-muted/20',
                  row.getIsSelected() && 'ring-2 ring-primary/40',
                )}
                onClick={() => onRowClick?.(row.index)}
                onKeyDown={(event) => {
                  if (!onRowClick) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onRowClick(row.index);
                  }
                }}
                role={onRowClick ? 'button' : undefined}
                tabIndex={onRowClick ? 0 : undefined}
              >
                {(enableRowSelection || renderExpandedRow) && (
                  <div className="mb-2 flex items-center justify-end gap-2">
                    {enableRowSelection && (
                      <Checkbox
                        checked={row.getIsSelected()}
                        onCheckedChange={(checked) => row.toggleSelected(Boolean(checked))}
                        aria-label={`${row.id} を選択`}
                        onClick={(event) => event.stopPropagation()}
                      />
                    )}
                    {renderExpandedRow && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-[44px] sm:min-h-0"
                        onClick={(event) => {
                          event.stopPropagation();
                          row.toggleExpanded();
                        }}
                      >
                        {row.getIsExpanded() ? '詳細を閉じる' : '詳細を開く'}
                      </Button>
                    )}
                  </div>
                )}
                {visibleCells.map((cell) => {
                  const meta = getColumnMeta(cell.column.columnDef);
                  return (
                    <div key={cell.id} className="flex items-start justify-between gap-2 py-1">
                      <span className="min-w-[6rem] text-xs font-medium text-muted-foreground">
                        {meta?.mobileLabel ?? getColumnLabel(cell.column.columnDef, cell.column.id)}
                      </span>
                      <span className="min-w-0 flex-1 break-words text-right text-sm text-foreground">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </span>
                    </div>
                  );
                })}
                {renderExpandedRow && row.getIsExpanded() && (
                  <div className="mt-3 border-t border-border/60 pt-3">
                    {renderExpandedRow(row)}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {hasMore && onLoadMore && (
        <div className="mt-4 flex justify-center">
          <LoadingButton
            variant="outline"
            onClick={onLoadMore}
            size="sm"
            className="min-h-[44px] sm:min-h-0"
            loading={isLoading}
            loadingLabel="読み込み中..."
          >
            さらに表示
          </LoadingButton>
        </div>
      )}
    </div>
  );
}
