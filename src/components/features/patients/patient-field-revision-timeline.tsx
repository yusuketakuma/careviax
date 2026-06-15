'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Loading } from '@/components/ui/loading';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { cn } from '@/lib/utils';
import type { PatientFieldRevisionListItem } from '@/server/services/patient-field-revision-list';

const CATEGORY_LABELS: Record<string, string> = {
  basic: '基本情報',
  residence: '住所',
  contacts: '連絡先',
  conditions: '病名',
  clinical: '臨床',
  insurance: '保険',
  medical_care: '医療処置',
  narcotic: '麻薬',
};

const SOURCE_LABELS: Record<string, string> = {
  patient_detail_edit: '患者詳細編集',
  visit_record: '訪問記録',
  mcs_sync: 'MCS連携',
  import: '取込',
};

// 識別子系(電話/住所)は変更履歴で生値を露出しない(UI/UX ガイドライン: PHI の取り扱い)
const SENSITIVE_FIELD_KEYS = new Set(['phone', 'address', 'building_id']);

function changeTypeMeta(item: PatientFieldRevisionListItem) {
  const hasPrev = item.previous != null && item.previous !== '';
  const hasCur = item.current != null && item.current !== '';
  if (!hasPrev && hasCur) {
    return { label: '追加', className: 'border-sky-200 bg-sky-50 text-sky-700' };
  }
  if (hasPrev && !hasCur) {
    return { label: '解除', className: 'border-slate-200 bg-slate-50 text-slate-600' };
  }
  return { label: '変更', className: 'border-amber-200 bg-amber-50 text-amber-700' };
}

function detailText(item: PatientFieldRevisionListItem): string | null {
  if (SENSITIVE_FIELD_KEYS.has(item.field_key)) return null; // 生値を出さず変更の事実のみ
  return item.value_label;
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-1 text-xs transition-colors',
        active
          ? 'border-sky-300 bg-sky-50 text-sky-700'
          : 'border-border/70 bg-background text-muted-foreground hover:bg-muted'
      )}
    >
      {children}
    </button>
  );
}

export function PatientFieldRevisionTimeline({ patientId }: { patientId: string }) {
  const orgId = useOrgId();
  const [category, setCategory] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['patient-field-revisions', patientId, orgId, category],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (category) params.set('category', category);
      const response = await fetch(`/api/patients/${patientId}/field-revisions?${params.toString()}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) {
        throw new Error('変更履歴の取得に失敗しました');
      }
      return (await response.json()) as { data: PatientFieldRevisionListItem[] };
    },
    enabled: !!orgId,
  });

  const revisions = data?.data ?? [];

  return (
    <div className="space-y-3" data-testid="patient-field-revision-timeline">
      <div className="flex flex-wrap gap-1.5">
        <FilterChip active={category === null} onClick={() => setCategory(null)}>
          すべて
        </FilterChip>
        {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
          <FilterChip key={key} active={category === key} onClick={() => setCategory(key)}>
            {label}
          </FilterChip>
        ))}
      </div>

      {isLoading ? (
        <Loading />
      ) : error ? (
        <p className="text-xs text-muted-foreground">変更履歴を取得できませんでした。</p>
      ) : revisions.length === 0 ? (
        <p className="text-xs text-muted-foreground">変更履歴はまだありません。</p>
      ) : (
        <ul className="space-y-2">
          {revisions.map((item) => {
            const meta = changeTypeMeta(item);
            const detail = detailText(item);
            return (
              <li
                key={item.id}
                className="rounded-lg border border-border/70 bg-background px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {CATEGORY_LABELS[item.category] ?? item.category}
                    </Badge>
                    <p className="truncate font-medium text-foreground">
                      {item.field_label ?? item.field_key}
                    </p>
                  </div>
                  <Badge variant="outline" className={cn('shrink-0 text-xs', meta.className)}>
                    {meta.label}
                  </Badge>
                </div>
                {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {format(new Date(item.created_at), 'M/d HH:mm')}
                  {' ・ '}
                  {item.updated_by_name ?? '—'}
                  {item.source && item.source !== 'patient_detail_edit'
                    ? ` ・ 確認元: ${SOURCE_LABELS[item.source] ?? item.source}`
                    : ''}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
