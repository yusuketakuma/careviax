'use client';

import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { cn } from '@/lib/utils';
import {
  REVISION_CATEGORY_LABELS,
  revisionChangeTypeMeta,
  revisionDetailText,
} from '@/components/features/patients/patient-field-revision-presentation';
import type { PatientFieldRevisionListItem } from '@/server/services/patient-field-revision-list';

/**
 * ⑤ 反映導線の「訪問側」provenance(read 専用)。
 * この訪問記録を出所(source_visit_record_id)として患者詳細(正本)へ反映された項目を示す。
 * 反映が無い訪問記録では描画しない(空カードを出さない)。
 */
export function VisitReflectedFieldsCard({ recordId }: { recordId: string }) {
  const orgId = useOrgId();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['visit-reflected-fields', recordId, orgId],
    queryFn: async () => {
      const res = await fetch(`/api/visit-records/${recordId}/reflected-fields`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) {
        throw new Error('反映項目の取得に失敗しました');
      }
      return (await res.json()) as { data: PatientFieldRevisionListItem[] };
    },
    enabled: !!orgId && !!recordId,
  });

  const items = data?.data ?? [];
  if (isLoading) return null;
  if (error) {
    return (
      <Card
        data-testid="visit-reflected-fields-card-error"
        className="border-state-confirm/30 bg-state-confirm/10"
      >
        <CardHeader className="pb-2">
          <h2 className="flex items-center gap-2 font-heading text-sm leading-snug font-medium text-state-confirm">
            <RefreshCw className="size-4 text-state-confirm" aria-hidden="true" />
            この訪問から患者詳細へ反映した項目
          </h2>
          <p className="text-xs leading-5 text-state-confirm">反映済み項目の取得に失敗しました。</p>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="bg-background"
            onClick={() => void refetch()}
          >
            再読み込み
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (items.length === 0) return null;

  return (
    <Card data-testid="visit-reflected-fields-card">
      <CardHeader className="pb-2">
        <h2 className="flex items-center gap-2 font-heading text-sm leading-snug font-medium">
          <RefreshCw className="size-4 text-muted-foreground" aria-hidden="true" />
          この訪問から患者詳細へ反映した項目
        </h2>
        <p className="text-xs leading-5 text-muted-foreground">
          この訪問記録を出所として患者詳細（正本）が更新された項目です。
        </p>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {items.map((item) => {
            const meta = revisionChangeTypeMeta(item);
            const detail = revisionDetailText(item);
            return (
              <li
                key={item.id}
                className="rounded-lg border border-border/70 bg-background px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {REVISION_CATEGORY_LABELS[item.category] ?? item.category}
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
                </p>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
