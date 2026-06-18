'use client';

/**
 * p0_06「詳しく絞り込む」中央カード型モーダル(shadcn Dialog)。
 * 6 条件フォーム + 『リセット』(outline) + 『この条件で探す』(青 primary)。
 * 値は AdvancedFilterState として親(SearchContent)に onApply で返す。
 */

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  type AdvancedFilterState,
  type VisitDateRangePreset,
  type CycleStatusOption,
  type CareTag,
  type ProposalStatusOption,
  type MedicationDeadlineDays,
  EMPTY_ADVANCED_FILTER,
  VISIT_DATE_RANGE_OPTIONS,
  CYCLE_STATUS_OPTIONS,
  CARE_TAG_OPTIONS,
  PROPOSAL_STATUS_OPTIONS,
  MEDICATION_DEADLINE_OPTIONS,
} from './advanced-filter.shared';

type Pharmacist = {
  id: string;
  name: string;
};

type AdvancedFilterModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 担当者選択肢(SearchContent が /api/pharmacists から取得して注入) */
  pharmacists: Pharmacist[];
  /** 初期値として表示するフィルタ状態 */
  initialFilter: AdvancedFilterState;
  /** 「この条件で探す」実行時に親へ返す */
  onApply: (filter: AdvancedFilterState) => void;
};

export function AdvancedFilterModal({
  open,
  onOpenChange,
  pharmacists,
  initialFilter,
  onApply,
}: AdvancedFilterModalProps) {
  const [filter, setFilter] = useState<AdvancedFilterState>(initialFilter);

  // initialFilter が外から変わったとき(SearchContent でリセット後再開など)に同期する
  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setFilter(initialFilter);
    }
    onOpenChange(nextOpen);
  };

  const handleReset = () => {
    // リセットは local state を空に戻すだけ。モーダルは閉じない。onApply は呼ばない。
    setFilter(EMPTY_ADVANCED_FILTER);
  };

  const handleApply = () => {
    onApply(filter);
    onOpenChange(false);
  };

  const setField = <K extends keyof AdvancedFilterState>(key: K, value: AdvancedFilterState[K]) => {
    setFilter((prev) => ({ ...prev, [key]: value }));
  };

  const toggleCareTag = (tag: CareTag) => {
    setFilter((prev) => ({
      ...prev,
      careTags: prev.careTags.includes(tag)
        ? prev.careTags.filter((t) => t !== tag)
        : [...prev.careTags, tag],
    }));
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>詳しく絞り込む</DialogTitle>
          <DialogDescription>患者名・日付・タグ・担当者で探せます。</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* 1. 訪問日 */}
          <div className="flex items-center gap-4">
            <span className="w-28 shrink-0 text-sm font-medium text-foreground">訪問日</span>
            <div className="flex-1">
              <Select
                value={filter.visitDateRange ?? ''}
                onValueChange={(value) =>
                  setField('visitDateRange', value ? (value as VisitDateRangePreset) : null)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="今日 〜 今週" />
                </SelectTrigger>
                <SelectContent>
                  {VISIT_DATE_RANGE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 2. 担当者 */}
          <div className="flex items-center gap-4">
            <span className="w-28 shrink-0 text-sm font-medium text-foreground">担当者</span>
            <div className="flex-1">
              <Select
                value={filter.assigneeId ?? ''}
                onValueChange={(value) => setField('assigneeId', value || null)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="山田 花子" />
                </SelectTrigger>
                <SelectContent>
                  {pharmacists.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 3. 現在の工程 */}
          <div className="flex items-center gap-4">
            <span className="w-28 shrink-0 text-sm font-medium text-foreground">現在の工程</span>
            <div className="flex-1">
              <Select
                value={filter.cycleStatus ?? ''}
                onValueChange={(value) =>
                  setField('cycleStatus', value ? (value as CycleStatusOption) : null)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="セット監査待ち / セット監査済み" />
                </SelectTrigger>
                <SelectContent>
                  {CYCLE_STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 4. 注意ポイント — 複数選択チップ */}
          <div className="flex items-start gap-4">
            <span className="w-28 shrink-0 pt-1 text-sm font-medium text-foreground">
              注意ポイント
            </span>
            <div className="flex flex-1 flex-wrap gap-2">
              {CARE_TAG_OPTIONS.map((opt) => {
                const isActive = filter.careTags.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleCareTag(opt.value)}
                    aria-pressed={isActive}
                    className={cn(
                      'inline-flex min-h-[36px] items-center rounded-full border px-4 text-sm font-medium transition-colors',
                      isActive
                        ? 'border-primary/20 bg-primary/10 text-primary'
                        : 'border-border bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 5. 予定の状態 — /api/visit-schedule-proposals?status= に接続 */}
          <div className="flex items-center gap-4">
            <span className="w-28 shrink-0 text-sm font-medium text-foreground">予定の状態</span>
            <div className="flex-1">
              <Select
                value={filter.proposalStatus ?? ''}
                onValueChange={(value) =>
                  setField('proposalStatus', value ? (value as ProposalStatusOption) : null)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="患者確認待ち / 正式決定" />
                </SelectTrigger>
                <SelectContent>
                  {PROPOSAL_STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 6. 薬切れ */}
          <div className="flex items-center gap-4">
            <span className="w-28 shrink-0 text-sm font-medium text-foreground">薬切れ</span>
            <div className="flex-1">
              <Select
                value={
                  filter.medicationDeadlineWithinDays != null
                    ? String(filter.medicationDeadlineWithinDays)
                    : ''
                }
                onValueChange={(value) =>
                  setField(
                    'medicationDeadlineWithinDays',
                    value ? (Number(value) as MedicationDeadlineDays) : null,
                  )
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="3日以内" />
                </SelectTrigger>
                <SelectContent>
                  {MEDICATION_DEADLINE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={String(opt.value)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {/* 『リセット』は outline、モーダルを閉じない。onApply は呼ばない。 */}
          <Button type="button" variant="outline" onClick={handleReset}>
            リセット
          </Button>
          {/* 『この条件で探す』はモーダル内唯一の青 primary ボタン */}
          <Button type="button" variant="default" onClick={handleApply}>
            この条件で探す
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
