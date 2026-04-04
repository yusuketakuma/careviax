'use client';

import { useCallback, useMemo, useState } from 'react';
import { FilePlus, AlertTriangle, FileText, Keyboard } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import { useKeyboardShortcuts, type ShortcutDefinition } from '@/components/features/keyboard/use-keyboard-shortcuts';
import { useSelectableQueueState } from '../dispensing/dispense-work-queue.shared';
import { PrescriptionsTable, type PrescriptionIntakeRow } from './prescriptions-table';
import { PrescriptionInlineDetail } from './prescription-inline-detail';

// ---------------------------------------------------------------------------
// Filter options
// ---------------------------------------------------------------------------

type FilterKey = 'all' | string;

const STATUS_FILTER_OPTIONS: Array<{ value: FilterKey; label: string }> = [
  { value: 'all', label: '全' },
  { value: 'intake_received', label: '受付' },
  { value: 'structuring', label: '構造化' },
  { value: 'inquiry_pending', label: '疑義' },
  { value: 'ready_to_dispense', label: '調剤待' },
  { value: 'dispensing', label: '調剤中' },
  { value: 'dispensed', label: '済' },
  { value: 'on_hold', label: '保留' },
];

const SOURCE_FILTER_OPTIONS: Array<{ value: FilterKey; label: string }> = [
  { value: 'all', label: '全' },
  { value: 'paper', label: '紙' },
  { value: 'fax', label: 'FAX' },
  { value: 'e_prescription', label: '電子' },
  { value: 'facility_batch', label: '施設' },
  { value: 'refill', label: 'リフィル' },
  { value: 'qr_scan', label: 'QR' },
];

// ---------------------------------------------------------------------------
// Workspace (レセコン風 master-detail)
// ---------------------------------------------------------------------------

export function PrescriptionsWorkspace() {
  const orgId = useOrgId();
  const [statusFilter, setStatusFilter] = useState<FilterKey>('all');
  const [sourceFilter, setSourceFilter] = useState<FilterKey>('all');

  // Fetch all intakes
  const { data, isLoading } = useRealtimeQuery({
    queryKey: ['prescription-intakes', orgId],
    queryFn: async () => {
      const all: PrescriptionIntakeRow[] = [];
      let cursor: string | undefined;
      for (;;) {
        const params = new URLSearchParams({ limit: '100' });
        if (cursor) params.set('cursor', cursor);
        const res = await fetch(`/api/prescription-intakes?${params}`, {
          headers: { 'x-org-id': orgId },
        });
        if (!res.ok) throw new Error('処方受付一覧の取得に失敗しました');
        const page = (await res.json()) as {
          data: PrescriptionIntakeRow[];
          hasMore: boolean;
          nextCursor?: string;
        };
        all.push(...page.data);
        if (!page.hasMore || !page.nextCursor) break;
        cursor = page.nextCursor;
      }
      return { data: all };
    },
    enabled: !!orgId,
    refetchInterval: 30_000,
    invalidateOn: ['cycle_transition', 'prescription_intake_created'],
  });

  const allItems = useMemo(() => data?.data ?? [], [data]);

  // Client-side filtering
  const filteredItems = useMemo(() => {
    let items = allItems;
    if (statusFilter !== 'all') {
      items = items.filter((item) => item.cycle.overall_status === statusFilter);
    }
    if (sourceFilter !== 'all') {
      items = items.filter((item) => item.source_type === sourceFilter);
    }
    return items;
  }, [allItems, statusFilter, sourceFilter]);

  // Status counts
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of allItems) {
      const s = item.cycle.overall_status;
      counts[s] = (counts[s] ?? 0) + 1;
    }
    return counts;
  }, [allItems]);

  // Selection state
  const {
    selectedItem,
    handleMoveUp,
    handleMoveDown,
    handleRowClick,
    resetSelection,
  } = useSelectableQueueState(filteredItems);

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

  const handleFilterStatus = useCallback((value: FilterKey) => {
    setStatusFilter(value);
    resetSelection();
  }, [resetSelection]);

  const handleFilterSource = useCallback((value: FilterKey) => {
    setSourceFilter(value);
    resetSelection();
  }, [resetSelection]);

  const inquiryCount = statusCounts['inquiry_pending'] ?? 0;
  const readyCount = statusCounts['ready_to_dispense'] ?? 0;

  return (
    <div className="flex h-[calc(100vh-64px)] flex-col overflow-hidden">
      {/* ━━ ステータスバー (レセコン上部) ━━ */}
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-1.5">
        {/* タイトル */}
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-primary" aria-hidden="true" />
          <h1 className="text-sm font-semibold text-foreground">処方受付</h1>
        </div>

        <div className="mx-1 h-4 w-px bg-border" />

        {/* 件数サマリ */}
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {filteredItems.length}/{allItems.length}件
        </span>

        {inquiryCount > 0 && (
          <Badge variant="destructive" className="h-5 gap-0.5 px-1.5 text-[10px]">
            <AlertTriangle className="size-2.5" aria-hidden="true" />
            疑義{inquiryCount}
          </Badge>
        )}
        {readyCount > 0 && (
          <Badge variant="default" className="h-5 gap-0.5 px-1.5 text-[10px] bg-green-600">
            調剤待{readyCount}
          </Badge>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="default" size="sm" className="h-7 gap-1 px-2.5 text-xs" asChild>
            <Link href="/prescriptions/new">
              <FilePlus className="size-3.5" aria-hidden="true" />
              新規受付
            </Link>
          </Button>
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" asChild>
            <Link href="/prescriptions/qr-drafts">QR下書き</Link>
          </Button>
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" asChild>
            <Link href="/dispensing">調剤キュー</Link>
          </Button>
        </div>
      </div>

      {/* ━━ フィルタバー ━━ */}
      <div className="flex items-center gap-1.5 overflow-x-auto border-b px-3 py-1 scrollbar-hide">
        <span className="shrink-0 text-[10px] font-medium text-muted-foreground">状態</span>
        {STATUS_FILTER_OPTIONS.map((opt) => {
          const isActive = statusFilter === opt.value;
          const count = opt.value === 'all' ? allItems.length : (statusCounts[opt.value] ?? 0);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleFilterStatus(opt.value)}
              className={`inline-flex h-5 shrink-0 items-center gap-0.5 rounded px-1.5 text-[10px] font-medium transition-colors ${
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted'
              }`}
            >
              {opt.label}
              {count > 0 && (
                <span className={`text-[9px] ${isActive ? 'text-primary-foreground/70' : 'text-muted-foreground/60'}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}

        <div className="mx-1 h-3 w-px shrink-0 bg-border" />

        <span className="shrink-0 text-[10px] font-medium text-muted-foreground">種別</span>
        {SOURCE_FILTER_OPTIONS.map((opt) => {
          const isActive = sourceFilter === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleFilterSource(opt.value)}
              className={`inline-flex h-5 shrink-0 items-center rounded px-1.5 text-[10px] font-medium transition-colors ${
                isActive
                  ? 'bg-secondary text-secondary-foreground'
                  : 'text-muted-foreground hover:bg-muted/50'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* ━━ メイン: マスタ-ディテール分割 ━━ */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左パネル: 処方一覧 */}
        <div className="w-[420px] shrink-0 overflow-hidden border-r lg:w-[480px]">
          <PrescriptionsTable
            items={filteredItems}
            isLoading={!orgId || isLoading}
            selectedId={selectedId}
            onRowClick={handleRowClick}
          />
        </div>

        {/* 右パネル: 詳細 */}
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

      {/* ━━ キーボードショートカットバー (レセコン下部) ━━ */}
      <div className="flex items-center gap-4 border-t bg-muted/30 px-3 py-1">
        <Keyboard className="size-3 text-muted-foreground" aria-hidden="true" />
        <div className="flex gap-3 text-[10px] text-muted-foreground">
          <span><kbd className="rounded border bg-background px-1 font-mono">↑</kbd><kbd className="ml-0.5 rounded border bg-background px-1 font-mono">↓</kbd> 選択</span>
          <span><kbd className="rounded border bg-background px-1 font-mono">N</kbd> <Link href="/prescriptions/new" className="hover:underline">新規受付</Link></span>
          <span><kbd className="rounded border bg-background px-1 font-mono">D</kbd> <Link href="/dispensing" className="hover:underline">調剤キュー</Link></span>
          <span><kbd className="rounded border bg-background px-1 font-mono">Q</kbd> <Link href="/prescriptions/qr-drafts" className="hover:underline">QR下書き</Link></span>
        </div>
      </div>
    </div>
  );
}
