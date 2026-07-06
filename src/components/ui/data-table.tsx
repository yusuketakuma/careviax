'use client';

import {
  type ColumnFiltersState,
  type ColumnDef,
  type ExpandedState,
  type PaginationState,
  type Row,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {
  Fragment,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  Columns3,
  Download,
  Printer,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
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
import { quotedCsvRow } from '@/lib/csv/safe-csv';
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
  serverExportEndpoint?: string;
  serverExportLabel?: string;
  serverExportDescription?: string;
  serverExportDisabledReason?: string;
  enablePrint?: boolean;
  disableActionsWhenInvalid?: boolean;
  exportFileName?: string;
  filterFields?: Array<{
    columnId: string;
    label: string;
    placeholder?: string;
  }>;
};

type DataTableRowInteractionMode = 'button' | 'selectable-listbox';

interface DataTableProps<TData> {
  columns: ColumnDef<TData>[];
  data: TData[];
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoading?: boolean;
  caption?: string;
  selectedRowIndex?: number;
  onRowClick?: (index: number) => void;
  rowInteractionMode?: DataTableRowInteractionMode;
  listboxLabel?: string;
  enableRowSelection?: boolean;
  onSelectionChange?: (rows: TData[]) => void;
  getRowId?: (originalRow: TData, index: number, parent?: Row<TData>) => string;
  getRowA11yLabel?: (row: TData, index: number) => string;
  renderExpandedRow?: (row: Row<TData>) => React.ReactNode;
  toolbar?: DataTableToolbarOptions;
  emptyMessage?: string;
  errorMessage?: string;
  errorActionLabel?: string;
  onRetry?: () => void;
  /**
   * opt-in クライアントページネーション。大量一覧の描画コスト対策(W2-F2)。
   * 既定 100行/ページ。未指定時は既存挙動(全行描画)のまま変わらない。
   */
  enablePagination?: boolean;
  pageSize?: number;
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

function normalizeServerExportEndpoint(endpoint: string | undefined) {
  const trimmed = endpoint?.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return null;
  if (/[\r\n\t]/.test(trimmed)) return null;
  return trimmed;
}

const TOOLBAR_ACTION_BUTTON_CLASSNAME = 'min-h-[44px] !min-h-[44px]';

export function DataTable<TData>({
  columns,
  data,
  onLoadMore,
  hasMore,
  isLoading,
  caption,
  selectedRowIndex,
  onRowClick,
  rowInteractionMode = 'button',
  listboxLabel,
  enableRowSelection,
  onSelectionChange,
  getRowId,
  getRowA11yLabel,
  renderExpandedRow,
  toolbar,
  emptyMessage = 'データがありません',
  errorMessage,
  errorActionLabel = '再読み込み',
  onRetry,
  enablePagination = false,
  pageSize = 100,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [globalFilter, setGlobalFilter] = useState('');
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [paginationState, setPaginationState] = useState<PaginationState>({
    pageIndex: 0,
    pageSize,
  });
  const toolbarDisabledReasonId = useId();
  const exportScopeWarningId = useId();
  const serverExportDescriptionId = useId();
  const serverExportDisabledReasonId = useId();
  const getResolvedRowA11yLabel = useCallback(
    (row: Row<TData>) => getRowA11yLabel?.(row.original, row.index) ?? row.id,
    [getRowA11yLabel],
  );
  const getRowActivationA11yLabel = useCallback(
    (row: Row<TData>) => `${getResolvedRowA11yLabel(row)} の詳細を表示`,
    [getResolvedRowA11yLabel],
  );
  const useSelectableListbox = Boolean(onRowClick && rowInteractionMode === 'selectable-listbox');
  const resolvedListboxLabel = listboxLabel ?? caption ?? '一覧';
  const getInteractiveRowProps = useCallback(
    (row: Row<TData>) => {
      if (!onRowClick) {
        return {};
      }

      const isSelectedOption = selectedRowIndex === row.index;
      return {
        onClick: () => onRowClick(row.index),
        onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onRowClick(row.index);
          }
        },
        role: useSelectableListbox ? 'option' : 'button',
        tabIndex: useSelectableListbox ? (isSelectedOption ? 0 : -1) : 0,
        'aria-label': useSelectableListbox
          ? getResolvedRowA11yLabel(row)
          : getRowActivationA11yLabel(row),
        'aria-selected': useSelectableListbox ? isSelectedOption : undefined,
      };
    },
    [
      getResolvedRowA11yLabel,
      getRowActivationA11yLabel,
      onRowClick,
      selectedRowIndex,
      useSelectableListbox,
    ],
  );

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
              aria-label="現在表示中の読込済み行をすべて選択"
            />
          </div>
        ),
        cell: ({ row }) => {
          const rowLabel = getResolvedRowA11yLabel(row);
          return (
            <div className="flex items-center justify-center">
              <Checkbox
                checked={row.getIsSelected()}
                onCheckedChange={(checked) => row.toggleSelected(Boolean(checked))}
                aria-label={`${rowLabel} を選択`}
                onClick={(event) => event.stopPropagation()}
              />
            </div>
          );
        },
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
        cell: ({ row }) => {
          const rowLabel = getResolvedRowA11yLabel(row);
          return (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-11 sm:size-7"
              onClick={(event) => {
                event.stopPropagation();
                row.toggleExpanded();
              }}
              aria-label={
                row.getIsExpanded() ? `${rowLabel} の詳細を閉じる` : `${rowLabel} の詳細を開く`
              }
            >
              <ChevronDown
                className={cn('size-4 transition-transform', row.getIsExpanded() && 'rotate-180')}
                aria-hidden="true"
              />
            </Button>
          );
        },
        enableSorting: false,
        enableHiding: false,
        enableResizing: false,
        size: 52,
      });
    }

    return [...leadingColumns, ...columns];
  }, [columns, enableRowSelection, getResolvedRowA11yLabel, renderExpandedRow]);

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
      ...(enablePagination ? { pagination: paginationState } : {}),
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
    ...(enablePagination
      ? { onPaginationChange: setPaginationState, getPaginationRowModel: getPaginationRowModel() }
      : {}),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  });

  // フィルタ/検索が変わったら現在ページを先頭へ戻す(既存フィルタ後の結果0件誤表示を防止)。
  useEffect(() => {
    if (!enablePagination) return;
    setPaginationState((previous) =>
      previous.pageIndex === 0 ? previous : { ...previous, pageIndex: 0 },
    );
  }, [enablePagination, globalFilter, columnFilters]);

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
  // フィルタ・ソート後の全行(ページネーション適用前)。CSV出力・件数表示・空判定の基準にする。
  // ページネーション未使用時は table.getRowModel().rows と常に同一集合。
  const fullRows = table.getSortedRowModel().rows;
  const toolbarActionsDisabled =
    toolbar?.disableActionsWhenInvalid !== false &&
    (Boolean(errorMessage) || Boolean(isLoading) || fullRows.length === 0);
  const toolbarDisabledReason = errorMessage
    ? '取得エラー中は出力できません'
    : isLoading
      ? '読み込み中は出力できません'
      : fullRows.length === 0
        ? '出力できる行がありません'
        : undefined;
  const hasUnloadedRows = Boolean(hasMore);
  const serverExportEndpoint = normalizeServerExportEndpoint(toolbar?.serverExportEndpoint);
  const hasServerExport = Boolean(toolbar?.serverExportEndpoint);
  const serverExportBlockReason = toolbar?.serverExportDisabledReason
    ? toolbar.serverExportDisabledReason
    : toolbar?.serverExportEndpoint && !serverExportEndpoint
      ? '全件出力のURLが安全な同一アプリ内パスではありません'
      : errorMessage
        ? '取得エラー中は全件出力できません'
        : isLoading
          ? '読み込み中は全件出力できません'
          : fullRows.length === 0 && !hasUnloadedRows
            ? '全件出力できる行がありません'
            : undefined;
  const serverExportDisabled =
    toolbar?.disableActionsWhenInvalid !== false && Boolean(serverExportBlockReason);
  const serverExportDisabledReason = serverExportDisabled ? serverExportBlockReason : undefined;
  const exportAriaDescription = toolbarActionsDisabled
    ? toolbarDisabledReasonId
    : hasUnloadedRows
      ? exportScopeWarningId
      : undefined;
  const serverExportAriaDescription = serverExportDisabledReason
    ? serverExportDisabledReasonId
    : serverExportDescriptionId;
  const serverExportLabel = toolbar?.serverExportLabel ?? '検索条件全件CSV出力';
  const serverExportDescription =
    toolbar?.serverExportDescription ??
    'サーバー側で監査・マスキング済みの検索条件全件を出力します。';
  const displayedEmptyMessage = errorMessage
    ? '取得エラーのため一覧を表示できません'
    : emptyMessage;
  const hasActiveFilters =
    globalFilter.trim().length > 0 ||
    columnFilters.some((filter) => String(filter.value ?? '').trim().length > 0);
  const emptyStateTitle = errorMessage
    ? displayedEmptyMessage
    : hasActiveFilters
      ? '条件に一致する行がありません'
      : displayedEmptyMessage;
  const emptyStateDescription = errorMessage
    ? '取得失敗は空状態とは別です。再読み込み、権限、接続状態を確認してください。'
    : hasActiveFilters
      ? '検索語やフィルタを減らすと、表示できる行が戻ります。'
      : '登録済みの行がある場合は、再読み込みしてください。';
  const currentPagination = table.getState().pagination;
  const currentPageNumber = currentPagination.pageIndex + 1;
  const currentPageCount = Math.max(table.getPageCount(), 1);
  const currentPageStart = currentPagination.pageIndex * currentPagination.pageSize + 1;
  const currentPageEnd = Math.min(
    (currentPagination.pageIndex + 1) * currentPagination.pageSize,
    fullRows.length,
  );

  function handleExport() {
    if (toolbarActionsDisabled) return;

    const headers = visibleLeafColumns.map((column) => getColumnLabel(column.columnDef, column.id));
    const rows = fullRows.map((row) =>
      visibleLeafColumns.map((column) => {
        const meta = getColumnMeta(column.columnDef);
        const value = meta?.exportValue ? meta.exportValue(row.original) : row.getValue(column.id);
        return stringifyExportValue(value);
      }),
    );

    const csv = [quotedCsvRow(headers), ...rows.map((row) => quotedCsvRow(row))].join('\n');
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
                        'flex min-h-[44px] items-center gap-1 rounded-md px-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
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
              <p className="text-sm text-muted-foreground">
                選択中{selectedCount}件（現在表示中の読込済み行から選択）
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {toolbarDisabledReason ? (
              <p id={toolbarDisabledReasonId} className="sr-only">
                {toolbarDisabledReason}
              </p>
            ) : null}
            {toolbar.enableColumnVisibility && visibleLeafColumns.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-[44px] sm:h-11 sm:min-h-[44px]"
                    />
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
              <div className="flex max-w-full flex-col items-start gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className={TOOLBAR_ACTION_BUTTON_CLASSNAME}
                  disabled={toolbarActionsDisabled}
                  title={toolbarDisabledReason}
                  aria-describedby={exportAriaDescription}
                  onClick={handleExport}
                >
                  <Download className="mr-1.5 size-3.5" aria-hidden="true" />
                  読込済みCSV出力
                </Button>
                {hasUnloadedRows && !toolbarActionsDisabled ? (
                  <p
                    id={exportScopeWarningId}
                    className="max-w-[18rem] text-xs leading-5 text-muted-foreground"
                  >
                    未読込行は出力対象外です。
                  </p>
                ) : null}
              </div>
            )}
            {hasServerExport && (
              <div className="flex max-w-full flex-col items-start gap-1">
                {serverExportEndpoint && !serverExportDisabled ? (
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className={TOOLBAR_ACTION_BUTTON_CLASSNAME}
                    aria-describedby={serverExportAriaDescription}
                  >
                    <a href={serverExportEndpoint}>
                      <Download className="mr-1.5 size-3.5" aria-hidden="true" />
                      {serverExportLabel}
                    </a>
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className={TOOLBAR_ACTION_BUTTON_CLASSNAME}
                    disabled
                    title={serverExportDisabledReason}
                    aria-describedby={serverExportAriaDescription}
                  >
                    <Download className="mr-1.5 size-3.5" aria-hidden="true" />
                    {serverExportLabel}
                  </Button>
                )}
                {serverExportDisabledReason ? (
                  <p id={serverExportDisabledReasonId} className="sr-only">
                    {serverExportDisabledReason}
                  </p>
                ) : (
                  <p
                    id={serverExportDescriptionId}
                    className="max-w-[20rem] text-xs leading-5 text-muted-foreground"
                  >
                    {serverExportDescription}
                  </p>
                )}
              </div>
            )}
            {toolbar.enablePrint && (
              <Button
                size="sm"
                variant="outline"
                className={TOOLBAR_ACTION_BUTTON_CLASSNAME}
                disabled={toolbarActionsDisabled}
                title={toolbarDisabledReason}
                aria-describedby={toolbarActionsDisabled ? toolbarDisabledReasonId : undefined}
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

      <div
        className="hidden overflow-auto rounded-md border border-border md:block"
        role={useSelectableListbox ? 'listbox' : undefined}
        aria-label={useSelectableListbox ? resolvedListboxLabel : undefined}
      >
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
                    className="px-4 py-8 text-center"
                  >
                    <EmptyState
                      icon={Search}
                      title={emptyStateTitle}
                      description={emptyStateDescription}
                      headingLevel={3}
                      className="border-0 bg-transparent p-6"
                    />
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row, index) => (
                  <Fragment key={row.id}>
                    <tr
                      className={cn(
                        'border-b border-border transition-colors last:border-0 hover:bg-muted/40',
                        index % 2 === 1 && 'bg-muted/20',
                        selectedRowIndex === row.index &&
                          'ring-2 ring-inset ring-primary/50 bg-primary/5',
                        row.getIsSelected() && 'bg-primary/5',
                      )}
                      {...getInteractiveRowProps(row)}
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

      <div
        className="space-y-2 md:hidden"
        role={useSelectableListbox ? 'listbox' : undefined}
        aria-label={useSelectableListbox ? resolvedListboxLabel : undefined}
      >
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
          <EmptyState
            icon={Search}
            title={emptyStateTitle}
            description={emptyStateDescription}
            headingLevel={3}
            className="mb-32 gap-1 p-2.5 [&_p]:text-xs [&_p]:leading-5"
          />
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
                  useSelectableListbox &&
                    selectedRowIndex === row.index &&
                    'ring-2 ring-primary/40 bg-primary/5',
                  row.getIsSelected() && 'ring-2 ring-primary/40',
                )}
                {...getInteractiveRowProps(row)}
              >
                {(enableRowSelection || renderExpandedRow) && (
                  <div className="mb-2 flex items-center justify-end gap-2">
                    {enableRowSelection && (
                      <Checkbox
                        checked={row.getIsSelected()}
                        onCheckedChange={(checked) => row.toggleSelected(Boolean(checked))}
                        aria-label={`${getResolvedRowA11yLabel(row)} を選択`}
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
                        aria-label={
                          row.getIsExpanded()
                            ? `${getResolvedRowA11yLabel(row)} の詳細を閉じる`
                            : `${getResolvedRowA11yLabel(row)} の詳細を開く`
                        }
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

      {enablePagination && fullRows.length > 0 ? (
        <div
          className="flex flex-col items-center justify-between gap-3 border-t border-border/60 pt-3 sm:flex-row"
          data-testid="data-table-pagination"
        >
          <p className="text-xs text-muted-foreground" data-testid="data-table-pagination-summary">
            {hasMore ? '読込済み' : '全'}
            {fullRows.length}件中 {currentPageStart}〜{currentPageEnd}件を表示（
            {currentPageNumber}/{currentPageCount}ページ{hasMore ? '、未読込行あり' : ''}）
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-[44px] sm:min-h-0"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label="前のページ"
            >
              <ChevronLeft className="mr-1 size-3.5" aria-hidden="true" />
              前へ
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-[44px] sm:min-h-0"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label="次のページ"
            >
              次へ
              <ChevronRight className="ml-1 size-3.5" aria-hidden="true" />
            </Button>
          </div>
        </div>
      ) : null}

      {hasMore && onLoadMore && (
        <div className="mt-4 flex justify-center">
          <LoadingButton
            variant="outline"
            onClick={onLoadMore}
            size="sm"
            className="min-h-[44px] sm:min-h-0"
            loading={isLoading}
            loadingLabel="追加行を読み込み中..."
          >
            さらに表示
          </LoadingButton>
        </div>
      )}
    </div>
  );
}
