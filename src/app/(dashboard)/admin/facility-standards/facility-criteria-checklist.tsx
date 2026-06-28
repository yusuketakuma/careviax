'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * p1_08「施設基準の確認」: 届出の要件達成状態(requirements_status)を
 * 在宅基準の代表項目チェックリスト(OK/不足/確認中)として見せ、
 * 不足項目には「足りないもの」ガイドを添える。
 */

export const FACILITY_CRITERIA_ITEMS = [
  {
    key: 'home_visit_record',
    label: '在宅実績',
    missingGuide:
      '在宅訪問の実績記録が不足しています。訪問記録の件数と対象期間を確認してください。',
  },
  {
    key: 'emergency_response',
    label: '緊急対応体制',
    missingGuide: '緊急時対応体制の整備記録が不足しています。連絡網と当番体制を確認してください。',
  },
  {
    key: 'training_record',
    label: '研修記録',
    missingGuide:
      '研修記録の添付が不足しています。提出前に、受講日・受講者・資料を確認してください。',
  },
  {
    key: 'document_delivery',
    label: '文書交付体制',
    missingGuide: '文書交付体制の記録が不足しています。交付手順と様式を確認してください。',
  },
  {
    key: 'electronic_collaboration',
    label: '電子的連携',
    missingGuide: '電子的連携の評価が未完了です。連携先と運用記録を確認してください。',
  },
] as const;

export type FacilityCriteriaStatus = 'ok' | 'missing' | 'checking';

export type FacilityCriteriaRow = {
  key: string;
  label: string;
  status: FacilityCriteriaStatus;
  missingGuide: string;
};

export type FacilityCriteriaSummary = {
  totalCount: number;
  okCount: number;
  missingCount: number;
  checkingCount: number;
  statusLabel: string;
  statusTone: FacilityCriteriaStatus;
  missingLabels: string[];
  nextAction: string;
};

/**
 * 届出群の requirements_status をマージして項目別の判定にする。
 * true が1件でもあれば OK、false があれば不足、どの届出にも無ければ確認中。
 */
export function buildFacilityCriteriaRows(
  registrations: Array<{ requirements_status: Record<string, boolean> | null }>,
): FacilityCriteriaRow[] {
  return FACILITY_CRITERIA_ITEMS.map((item) => {
    const values = registrations
      .map((registration) => registration.requirements_status?.[item.key])
      .filter((value): value is boolean => typeof value === 'boolean');
    const status: FacilityCriteriaStatus =
      values.length === 0 ? 'checking' : values.some((value) => value === false) ? 'missing' : 'ok';
    return { key: item.key, label: item.label, status, missingGuide: item.missingGuide };
  });
}

export function summarizeFacilityCriteriaRows(
  rows: FacilityCriteriaRow[],
): FacilityCriteriaSummary {
  const missingRows = rows.filter((row) => row.status === 'missing');
  const checkingRows = rows.filter((row) => row.status === 'checking');
  const okCount = rows.filter((row) => row.status === 'ok').length;

  if (missingRows.length > 0) {
    return {
      totalCount: rows.length,
      okCount,
      missingCount: missingRows.length,
      checkingCount: checkingRows.length,
      statusLabel: '算定不可',
      statusTone: 'missing',
      missingLabels: missingRows.map((row) => row.label),
      nextAction: `${missingRows[0]?.label ?? '不足項目'}の資料を追加してから再確認します。`,
    };
  }

  if (checkingRows.length > 0) {
    return {
      totalCount: rows.length,
      okCount,
      missingCount: 0,
      checkingCount: checkingRows.length,
      statusLabel: '確認中',
      statusTone: 'checking',
      missingLabels: [],
      nextAction: `${checkingRows[0]?.label ?? '未確認項目'}の判定を完了すると算定可否が確定します。`,
    };
  }

  return {
    totalCount: rows.length,
    okCount,
    missingCount: 0,
    checkingCount: 0,
    statusLabel: '算定可',
    statusTone: 'ok',
    missingLabels: [],
    nextAction: '現時点で不足はありません。期限アラートだけ継続確認します。',
  };
}

// 要件達成状態を 6 軸トークンへ:OK=done(緑) / 不足=confirm(橙 要対応) / 確認中=confirm(橙 要確認)。
const STATUS_BADGES: Record<FacilityCriteriaStatus, { label: string; className: string }> = {
  ok: { label: 'OK', className: 'border-state-done/30 bg-state-done/10 text-state-done' },
  missing: {
    label: '不足',
    className: 'border-state-confirm/30 bg-state-confirm/10 text-state-confirm',
  },
  checking: {
    label: '確認中',
    className: 'border-state-confirm/30 bg-state-confirm/10 text-state-confirm',
  },
};

const ROW_TONES: Record<FacilityCriteriaStatus, string> = {
  ok: 'border-state-done/30 bg-state-done/10',
  missing: 'border-state-confirm/30 bg-state-confirm/10',
  checking: 'border-state-confirm/30 bg-state-confirm/10',
};

export function FacilityCriteriaChecklist({
  registrations,
  onAddDocument,
}: {
  registrations: Array<{ requirements_status: Record<string, boolean> | null }>;
  onAddDocument: () => void;
}) {
  const rows = buildFacilityCriteriaRows(registrations);
  const missingRows = rows.filter((row) => row.status === 'missing');

  return (
    <section
      data-testid="facility-criteria-checklist"
      aria-label="施設基準の確認"
      className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
    >
      <div className="rounded-lg border border-border/70 bg-card p-4">
        <h2 className="text-sm font-bold text-foreground">施設基準チェック</h2>
        <ul className="mt-3 space-y-2.5" role="list">
          {rows.map((row) => {
            const badge = STATUS_BADGES[row.status];
            return (
              <li
                key={row.key}
                data-testid="facility-criteria-row"
                data-status={row.status}
                className={cn(
                  'flex min-h-14 items-center justify-between gap-3 rounded-lg border px-4 py-2.5',
                  ROW_TONES[row.status],
                )}
              >
                <span className="text-sm font-medium text-foreground">{row.label}</span>
                <span
                  className={cn(
                    'inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold',
                    badge.className,
                  )}
                >
                  {badge.label}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="h-fit rounded-lg border border-border/70 bg-card p-4">
        <h2 className="text-sm font-bold text-foreground">足りないもの</h2>
        {missingRows.length === 0 ? (
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            不足はありません。確認中の項目は評価が終わると OK / 不足に変わります。
          </p>
        ) : (
          <div className="mt-3 space-y-2.5">
            {missingRows.map((row) => (
              <p key={row.key} className="text-sm leading-6 text-foreground">
                {row.missingGuide}
              </p>
            ))}
          </div>
        )}
        <Button type="button" className="mt-5 w-full sm:w-52" onClick={onAddDocument}>
          資料を追加
        </Button>
      </div>
    </section>
  );
}
