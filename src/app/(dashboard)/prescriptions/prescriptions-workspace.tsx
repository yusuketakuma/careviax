'use client';

import { useCallback, useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { FilePlus, FileText, Keyboard } from 'lucide-react';
import Link from 'next/link';
import { ActionRail } from '@/components/ui/action-rail';
import { Button } from '@/components/ui/button';
import { FilterSummaryBar } from '@/components/ui/filter-summary-bar';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useRealtimeInvalidation } from '@/lib/hooks/use-realtime-invalidation';
import { CYCLE_STATUS_SHORT_LABELS } from '@/lib/prescription/cycle-workspace';
import {
  useKeyboardShortcuts,
  type ShortcutDefinition,
} from '@/components/features/keyboard/use-keyboard-shortcuts';
import { cn } from '@/lib/utils';
import { useSelectableQueueState } from '../dispense/dispense-work-queue.shared';
import { PrescriptionsTable, type PrescriptionIntakeRow } from './prescriptions-table';
import { PrescriptionInlineDetail } from './prescription-inline-detail';

// ---------------------------------------------------------------------------
// Filter options
// ---------------------------------------------------------------------------

type FilterKey = 'all' | string;
type FilterOption = { value: FilterKey; label: string };

const PRESCRIPTION_INTAKE_PAGE_SIZE = 50;
const REALTIME_INVALIDATE_EVENTS = [
  'workflow_refresh',
  'cycle_transition',
  'qr_draft_confirmed',
] as const;

const STATUS_FILTER_OPTIONS: FilterOption[] = [
  { value: 'all', label: '全' },
  { value: 'intake_received', label: CYCLE_STATUS_SHORT_LABELS.intake_received },
  { value: 'structuring', label: CYCLE_STATUS_SHORT_LABELS.structuring },
  { value: 'inquiry_pending', label: CYCLE_STATUS_SHORT_LABELS.inquiry_pending },
  { value: 'ready_to_dispense', label: CYCLE_STATUS_SHORT_LABELS.ready_to_dispense },
  { value: 'dispensing', label: CYCLE_STATUS_SHORT_LABELS.dispensing },
  { value: 'dispensed', label: CYCLE_STATUS_SHORT_LABELS.dispensed },
  { value: 'on_hold', label: CYCLE_STATUS_SHORT_LABELS.on_hold },
];

const SOURCE_FILTER_OPTIONS: FilterOption[] = [
  { value: 'all', label: '全' },
  { value: 'paper', label: '紙' },
  { value: 'fax', label: 'FAX' },
  { value: 'e_prescription', label: '電子' },
  { value: 'facility_batch', label: '施設' },
  { value: 'refill', label: 'リフィル' },
  { value: 'qr_scan', label: 'QR' },
];

type PrescriptionIntakesPage = {
  data: PrescriptionIntakeRow[];
  hasMore: boolean;
  nextCursor?: string;
  totalCount?: number;
};

function PrescriptionFilterGroup({
  label,
  options,
  activeValue,
  activeClassName,
  inactiveClassName,
  onSelect,
}: {
  label: string;
  options: FilterOption[];
  activeValue: FilterKey;
  activeClassName: string;
  inactiveClassName: string;
  onSelect: (value: FilterKey) => void;
}) {
  return (
    <>
      <span className="shrink-0 text-[10px] font-medium text-muted-foreground">{label}</span>
      {options.map((opt) => {
        const isActive = activeValue === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onSelect(opt.value)}
            className={cn(
              'inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded px-2 text-[10px] font-medium transition-colors sm:h-5 sm:min-h-0 sm:min-w-0 sm:px-1.5',
              isActive ? activeClassName : inactiveClassName,
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </>
  );
}

function PrescriptionShortcutRail() {
  const shortcuts = [
    { key: 'N', href: '/prescriptions/new', label: '新規受付' },
    { key: 'D', href: '/dispense', label: '調剤キュー' },
    { key: 'Q', href: '/prescriptions/qr-drafts', label: 'QR下書き' },
  ];

  return (
    <div className="flex items-center gap-4 border-t bg-muted/30 px-3 py-1">
      <Keyboard className="size-3 text-muted-foreground" aria-hidden="true" />
      <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
        <span>
          <kbd className="rounded border bg-background px-1 font-mono">↑</kbd>
          <kbd className="ml-0.5 rounded border bg-background px-1 font-mono">↓</kbd> 選択
        </span>
        {shortcuts.map((shortcut) => (
          <span key={shortcut.key}>
            <kbd className="rounded border bg-background px-1 font-mono">{shortcut.key}</kbd>{' '}
            <Link
              href={shortcut.href}
              className="inline-flex min-h-[44px] min-w-[44px] items-center hover:underline sm:min-h-0 sm:min-w-0"
            >
              {shortcut.label}
            </Link>
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workspace (レセコン風 master-detail)
// ---------------------------------------------------------------------------

export function PrescriptionsWorkspace({ className }: { className?: string } = {}) {
  const orgId = useOrgId();
  const [statusFilter, setStatusFilter] = useState<FilterKey>('all');
  const [sourceFilter, setSourceFilter] = useState<FilterKey>('all');

  const queryKey = useMemo(
    () => ['prescription-intakes', orgId, statusFilter, sourceFilter] as const,
    [orgId, statusFilter, sourceFilter],
  );

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({
        limit: String(PRESCRIPTION_INTAKE_PAGE_SIZE),
        include_total: '1',
      });
      if (pageParam) params.set('cursor', pageParam);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (sourceFilter !== 'all') params.set('source_type', sourceFilter);

      const res = await fetch(`/api/prescription-intakes?${params}`, {
        headers: buildOrgHeaders(orgId),
      });
      if (!res.ok) throw new Error('処方受付一覧の取得に失敗しました');
      return res.json() as Promise<PrescriptionIntakesPage>;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: undefined as string | undefined,
    enabled: !!orgId,
  });

  useRealtimeInvalidation({
    queryKey: ['prescription-intakes', orgId],
    enabled: !!orgId,
    invalidateOn: REALTIME_INVALIDATE_EVENTS,
  });

  const loadedItems = useMemo(() => data?.pages.flatMap((page) => page.data) ?? [], [data]);
  const totalMatchingCount = data?.pages[0]?.totalCount ?? loadedItems.length;

  // Counts reflect the loaded page window. Totals come from the server-side filtered query.
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of loadedItems) {
      const s = item.cycle.overall_status;
      counts[s] = (counts[s] ?? 0) + 1;
    }
    return counts;
  }, [loadedItems]);

  // Selection state
  const { selectedItem, handleMoveUp, handleMoveDown, handleRowClick, resetSelection } =
    useSelectableQueueState(loadedItems);

  const selectedId = selectedItem?.id ?? null;

  // Keyboard shortcuts
  const shortcuts: ShortcutDefinition[] = useMemo(
    () => [
      { key: 'ArrowUp', handler: handleMoveUp, description: '前の行', scope: 'prescriptions' },
      { key: 'ArrowDown', handler: handleMoveDown, description: '次の行', scope: 'prescriptions' },
    ],
    [handleMoveUp, handleMoveDown],
  );
  useKeyboardShortcuts(shortcuts);

  const handleFilterStatus = useCallback(
    (value: FilterKey) => {
      setStatusFilter(value);
      resetSelection();
    },
    [resetSelection],
  );

  const handleFilterSource = useCallback(
    (value: FilterKey) => {
      setSourceFilter(value);
      resetSelection();
    },
    [resetSelection],
  );

  const inquiryCount = statusCounts['inquiry_pending'] ?? 0;
  const readyCount = statusCounts['ready_to_dispense'] ?? 0;

  return (
    <div className={cn('flex h-[calc(100dvh-64px)] flex-col overflow-hidden', className)}>
      <div className="flex flex-col gap-2 border-b bg-muted/40 px-3 py-2 lg:flex-row lg:items-center">
        <div className="flex shrink-0 items-center gap-2">
          <FileText className="size-4 text-primary" aria-hidden="true" />
          <span className="text-sm font-semibold text-foreground">処方受付</span>
        </div>

        <FilterSummaryBar
          className="min-w-0 flex-1 border-border/60 bg-background/70 py-2 lg:py-1.5"
          items={[
            { label: '読込', value: `${loadedItems.length}/${totalMatchingCount}件` },
            {
              label: '疑義',
              value: `${inquiryCount}件`,
              tone: inquiryCount > 0 ? 'danger' : 'default',
            },
            {
              label: '調剤待',
              value: `${readyCount}件`,
              tone: readyCount > 0 ? 'warning' : 'default',
            },
          ]}
          actions={
            <ActionRail>
              <Button
                variant="default"
                size="sm"
                className="h-10 gap-1 px-2.5 text-xs sm:h-7"
                asChild
              >
                <Link href="/prescriptions/new">
                  <FilePlus className="size-3.5" aria-hidden="true" />
                  新規受付
                </Link>
              </Button>
              <Button variant="outline" size="sm" className="h-10 px-2 text-xs sm:h-7" asChild>
                <Link href="/prescriptions/qr-drafts">QR下書き</Link>
              </Button>
              <Button variant="outline" size="sm" className="h-10 px-2 text-xs sm:h-7" asChild>
                <Link href="/dispense">調剤キュー</Link>
              </Button>
            </ActionRail>
          }
        />
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto border-b px-3 py-1 scrollbar-hide">
        <PrescriptionFilterGroup
          label="状態"
          options={STATUS_FILTER_OPTIONS}
          activeValue={statusFilter}
          activeClassName="bg-primary text-primary-foreground"
          inactiveClassName="bg-muted/50 text-muted-foreground hover:bg-muted"
          onSelect={handleFilterStatus}
        />
        <div className="mx-1 h-3 w-px shrink-0 bg-border" />
        <PrescriptionFilterGroup
          label="種別"
          options={SOURCE_FILTER_OPTIONS}
          activeValue={sourceFilter}
          activeClassName="bg-secondary text-secondary-foreground"
          inactiveClassName="text-muted-foreground hover:bg-muted/50"
          onSelect={handleFilterSource}
        />
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex w-[420px] shrink-0 flex-col overflow-hidden border-r lg:w-[480px]">
          <div className="min-h-0 flex-1 overflow-hidden">
            <PrescriptionsTable
              items={loadedItems}
              isLoading={!orgId || isLoading}
              selectedId={selectedId}
              onRowClick={handleRowClick}
            />
          </div>
          {hasNextPage && (
            <div className="border-t bg-background px-3 py-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 w-full text-xs"
                onClick={() => void fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? '読み込み中...' : 'さらに読み込む'}
              </Button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-hidden">
          {selectedId ? (
            <PrescriptionInlineDetail intakeId={selectedId} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
              <FileText className="size-10 opacity-20" aria-hidden="true" />
              <div className="text-center">
                <p className="text-sm">左の一覧から処方を選択してください</p>
                <p className="mt-1 text-xs">↑↓ キーで行を移動できます</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <PrescriptionShortcutRail />
    </div>
  );
}
