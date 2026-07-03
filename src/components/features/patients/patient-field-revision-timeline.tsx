'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Loading } from '@/components/ui/loading';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { cn } from '@/lib/utils';
import type {
  PatientFieldRevisionListItem,
  PatientFieldRevisionListMeta,
} from '@/server/services/patient-field-revision-list';
import {
  REVISION_CATEGORY_LABELS as CATEGORY_LABELS,
  REVISION_SOURCE_LABELS as SOURCE_LABELS,
  revisionChangeTypeMeta as changeTypeMeta,
  revisionDetailText as detailText,
} from './patient-field-revision-presentation';

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
          ? 'border-tag-info/40 bg-tag-info/10 text-tag-info'
          : 'border-border/70 bg-background text-muted-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}

type PatientFieldRevisionTimelineResponse = {
  data: PatientFieldRevisionListItem[];
  meta?: PatientFieldRevisionListMeta;
};

export function PatientFieldRevisionTimeline({ patientId }: { patientId: string }) {
  const orgId = useOrgId();
  const [category, setCategory] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['patient-field-revisions', patientId, orgId, category],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (category) params.set('category', category);
      const response = await fetch(
        `${buildPatientApiPath(patientId, '/field-revisions')}?${params.toString()}`,
        {
          headers: buildOrgHeaders(orgId),
        },
      );
      if (!response.ok) {
        throw new Error('変更履歴の取得に失敗しました');
      }
      return (await response.json()) as PatientFieldRevisionTimelineResponse;
    },
    enabled: !!orgId,
  });

  const revisions = data?.data ?? [];
  const meta = data?.meta;

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
        <div className="space-y-2">
          {meta?.truncated ? (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              先頭{meta.visible_count}件を表示 / 他{meta.hidden_count}件
            </p>
          ) : null}
          <ul className="space-y-2">
            {revisions.map((item) => {
              const itemMeta = changeTypeMeta(item);
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
                    <Badge variant="outline" className={cn('shrink-0 text-xs', itemMeta.className)}>
                      {itemMeta.label}
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
        </div>
      )}
    </div>
  );
}
