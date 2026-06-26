'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { ErrorState } from '@/components/ui/error-state';
import { listEvidenceDraftSummaries } from '@/lib/offline/evidence-drafts';
import { cn } from '@/lib/utils';
import {
  EVIDENCE_CATEGORIES,
  buildEvidenceItemsFromOfflineDrafts,
  buildEvidenceItemsFromVisitRecords,
  filterEvidenceItemsByCategory,
  formatCaptureTime,
  mergeEvidenceItems,
  sortEvidenceItems,
  summarizeEvidenceGallery,
  type EvidenceCategoryId,
  type EvidenceGalleryItem,
  type VisitRecordDetailForEvidence,
} from './evidence-gallery.shared';
import { buildEvidenceDemoItems } from './evidence-gallery.demo';

/**
 * p0_33「画像・証跡」: 訪問で残した写真・文書を種類別に確認するギャラリー。
 * 左で証跡の種類を選び、右にサーバー保存済み(同期済み)と端末上のみ(未同期)を
 * 統合した画像一覧を表示する。サーバー側は既存の visit-records API、
 * 端末側は p0_48 のオフライン写真ドラフト(IndexedDB)を読む。
 */

/** 添付を取りに行く訪問記録の最大件数(詳細 API の N+1 を抑える) */
const MAX_RECORDS_FOR_ATTACHMENTS = 12;

type VisitRecordListResponse = {
  data?: VisitRecordDetailForEvidence[];
};

/** 証跡ギャラリー用に、添付 summary を含む訪問記録一覧を 1 回で取得する。 */
export async function fetchVisitRecordsWithAttachments(
  orgId: string,
): Promise<VisitRecordDetailForEvidence[]> {
  const headers = { 'x-org-id': orgId };
  const listRes = await fetch(
    `/api/visit-records?limit=${MAX_RECORDS_FOR_ATTACHMENTS}&include_attachments=true&view=evidence_gallery`,
    {
      headers,
    },
  );
  if (!listRes.ok) throw new Error('訪問記録の取得に失敗しました');
  const list = (await listRes.json()) as VisitRecordListResponse;
  return (list.data ?? []).slice(0, MAX_RECORDS_FOR_ATTACHMENTS);
}

const SYNC_BADGE_CLASSES: Record<EvidenceGalleryItem['syncState'], string> = {
  pending: 'bg-state-confirm/10 text-state-confirm',
  synced: 'bg-state-done/10 text-state-done',
};

const SYNC_BADGE_LABELS: Record<EvidenceGalleryItem['syncState'], string> = {
  pending: '未同期',
  synced: '同期済み',
};

export function EvidenceGalleryContent() {
  const orgId = useOrgId();
  const [selectedCategory, setSelectedCategory] =
    React.useState<EvidenceCategoryId>('residual_photo');
  const [demoItems, setDemoItems] = React.useState<EvidenceGalleryItem[] | null>(null);

  const {
    data: serverItems,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['visit-evidence-gallery', orgId],
    enabled: !!orgId,
    queryFn: async () =>
      buildEvidenceItemsFromVisitRecords(await fetchVisitRecordsWithAttachments(orgId)),
  });

  // p0_48 のモバイル撮影で端末保存された未同期ドラフト(IndexedDB)
  const { data: offlineDraftItems } = useQuery({
    queryKey: ['visit-evidence-offline-drafts'],
    queryFn: async () => buildEvidenceItemsFromOfflineDrafts(await listEvidenceDraftSummaries()),
  });

  // 撮影・動作確認用のデモ注入(dev 限定、p0_34 の window フックの作法)。
  // 注入後は決定的な一覧(未同期/同期済み混在)へ差し替える。
  React.useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const target = window;
    target.__phosSeedEvidenceDemo = () => {
      setDemoItems(buildEvidenceDemoItems());
    };
    return () => {
      delete target.__phosSeedEvidenceDemo;
    };
  }, []);

  const items = React.useMemo(
    () =>
      demoItems
        ? sortEvidenceItems(demoItems)
        : mergeEvidenceItems(serverItems ?? [], offlineDraftItems ?? []),
    [demoItems, serverItems, offlineDraftItems],
  );

  const visibleItems = React.useMemo(
    () => filterEvidenceItemsByCategory(items, selectedCategory),
    [items, selectedCategory],
  );
  const summary = React.useMemo(
    () => summarizeEvidenceGallery(items, selectedCategory),
    [items, selectedCategory],
  );

  const selectedCategoryLabel =
    EVIDENCE_CATEGORIES.find((category) => category.id === selectedCategory)?.label ?? '証跡';

  return (
    <div data-testid="evidence-gallery-page">
      <h1 className="sr-only">画像・証跡</h1>

      <section
        aria-label="証跡サマリー"
        className="mb-4 rounded-xl border border-border/70 bg-card p-5 shadow-sm"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-sm font-bold text-foreground">今日の証跡状況</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{summary.nextAction}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:min-w-[520px]">
            <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
              <p className="text-[11px] font-bold text-muted-foreground">合計</p>
              <p className="mt-1 text-lg font-bold text-foreground">{summary.totalCount}枚</p>
            </div>
            <div className="rounded-lg border border-border/60 border-l-4 border-l-state-confirm bg-card px-3 py-2">
              <p className="text-[11px] font-bold text-state-confirm">未同期</p>
              <p className="mt-1 text-lg font-bold text-state-confirm">{summary.pendingCount}枚</p>
            </div>
            <div className="rounded-lg border border-border/60 border-l-4 border-l-state-done bg-card px-3 py-2">
              <p className="text-[11px] font-bold text-state-done">同期済み</p>
              <p className="mt-1 text-lg font-bold text-state-done">{summary.syncedCount}枚</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
              <p className="text-[11px] font-bold text-muted-foreground">
                {summary.selectedCategoryLabel}
              </p>
              <p className="mt-1 text-lg font-bold text-foreground">
                {summary.selectedCategoryCount}枚
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        {/* 左: 証跡の種類(選択でフィルタ) */}
        <section
          aria-label="証跡の種類"
          className="rounded-xl border border-border/70 bg-card shadow-sm"
        >
          <h2 className="border-b border-border/60 px-5 py-4 text-sm font-bold text-foreground">
            証跡の種類
          </h2>
          <ul className="space-y-5 p-5" role="list">
            {EVIDENCE_CATEGORIES.map((category) => {
              const selected = category.id === selectedCategory;
              return (
                <li key={category.id}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    data-testid="evidence-category-item"
                    className={cn(
                      'min-h-11 w-full rounded-lg border px-4 py-3 text-left text-sm font-medium text-foreground transition-colors',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                      selected
                        ? 'border-primary/25 bg-primary/10'
                        : 'border-border/70 bg-card hover:bg-muted/40',
                    )}
                    onClick={() => setSelectedCategory(category.id)}
                  >
                    {category.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* 右: 画像一覧(未同期=橙 / 同期済み=緑 + 撮影時刻) */}
        <section
          aria-label="画像一覧"
          className="rounded-xl border border-border/70 bg-card shadow-sm"
        >
          <h2 className="border-b border-border/60 px-5 py-4 text-sm font-bold text-foreground">
            画像一覧
          </h2>
          <div className="p-5">
            {isLoading && !demoItems ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                画像を読み込んでいます...
              </p>
            ) : isError && visibleItems.length === 0 ? (
              // 取得失敗を「画像はまだありません」(空)に倒さない。オフライン下書き等で
              // 表示できるものがある場合はそちらを優先し、何も無いときだけ ErrorState。
              <ErrorState
                variant="server"
                size="inline"
                title="画像・証跡を取得できませんでした"
                description="時間をおいて再試行してください。"
                action={{ label: '再試行', onClick: () => refetch() }}
              />
            ) : visibleItems.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-10 text-center">
                <p className="text-sm leading-6 text-muted-foreground">
                  {selectedCategoryLabel}の画像はまだありません。
                  <br />
                  訪問記録の「写真・添付」から追加すると、ここに表示されます。
                </p>
              </div>
            ) : (
              <ul
                className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 2xl:grid-cols-4"
                role="list"
                data-testid="evidence-photo-grid"
              >
                {visibleItems.map((item) => {
                  const captureTime = formatCaptureTime(item.capturedAt);
                  return (
                    <li
                      key={item.id}
                      data-testid="evidence-photo-card"
                      className="flex min-h-44 flex-col rounded-lg border border-border/60 bg-muted/40 p-3"
                    >
                      {/* 実画像なしのプレースホルダー(target 準拠) */}
                      <div className="flex flex-1 items-center justify-center py-8">
                        <span
                          className="text-lg font-medium text-muted-foreground"
                          aria-hidden="true"
                        >
                          写真
                        </span>
                        {item.fileName ? <span className="sr-only">{item.fileName}</span> : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-bold',
                            SYNC_BADGE_CLASSES[item.syncState],
                          )}
                        >
                          {SYNC_BADGE_LABELS[item.syncState]}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {captureTime ? `撮影 ${captureTime}` : '撮影時刻不明'}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
