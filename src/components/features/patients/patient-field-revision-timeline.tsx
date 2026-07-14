'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  FilterChipBar,
  type FilterChipOption,
} from '@/components/features/workspace/filter-chip-bar';
import { Skeleton } from '@/components/ui/loading';
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { REVISION_CATEGORY_LABELS as CATEGORY_LABELS } from './patient-field-revision-presentation';
import { PatientFieldRevisionList } from './patient-field-revision-entry';
import { createPatientFieldRevisionTimelineResponseSchema } from './patient-field-revision-timeline-response-schema';

const ALL_CATEGORIES = '__all__';
const CATEGORY_FILTER_OPTIONS: Array<FilterChipOption<string>> = [
  { value: ALL_CATEGORIES, label: 'すべて' },
  ...Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label })),
];

function PatientFieldRevisionLoadingState() {
  return (
    <div className="space-y-2" role="status" aria-label="変更履歴を読み込み中">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="rounded-lg border border-border/70 bg-background px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
          <Skeleton className="mt-2 h-3 w-3/4" />
          <Skeleton className="mt-2 h-3 w-1/2" />
        </div>
      ))}
      <span className="sr-only">変更履歴を読み込んでいます。</span>
    </div>
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
      const response = await fetch(
        `${buildPatientApiPath(patientId, '/field-revisions')}?${params.toString()}`,
        {
          headers: buildOrgHeaders(orgId),
        },
      );
      return readApiJson(response, {
        fallbackMessage: '変更履歴の取得に失敗しました',
        schema: createPatientFieldRevisionTimelineResponseSchema(category),
      });
    },
    enabled: !!orgId,
  });

  const revisions = data?.data ?? [];
  const meta = data?.meta;

  return (
    <div className="space-y-3" data-testid="patient-field-revision-timeline">
      <FilterChipBar
        options={CATEGORY_FILTER_OPTIONS}
        value={category ?? ALL_CATEGORIES}
        onChange={(next) => setCategory(next === ALL_CATEGORIES ? null : next)}
        ariaLabel="変更履歴のカテゴリ"
      />

      {isLoading ? (
        <PatientFieldRevisionLoadingState />
      ) : error ? (
        <p className="text-xs text-muted-foreground">変更履歴を取得できませんでした。</p>
      ) : revisions.length === 0 ? (
        <p className="text-xs text-muted-foreground">変更履歴はまだありません。</p>
      ) : (
        <div className="space-y-2">
          {meta?.truncated ? (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              直近{meta.visible_count}件を過去から現在の順で表示 / それ以前
              {meta.hidden_count}件
            </p>
          ) : null}
          <PatientFieldRevisionList items={revisions} showCurrentTerminus={category === null} />
        </div>
      )}
    </div>
  );
}
