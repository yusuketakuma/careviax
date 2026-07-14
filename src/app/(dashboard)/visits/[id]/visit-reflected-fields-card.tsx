'use client';

import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { buildVisitReflectedFieldsApiPath } from '@/lib/visits/api-paths';
import { PatientFieldRevisionList } from '@/components/features/patients/patient-field-revision-entry';
import { visitReflectedFieldsResponseSchema } from './visit-reflected-fields-response-schema';

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
      const res = await fetch(buildVisitReflectedFieldsApiPath(recordId), {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson(res, {
        fallbackMessage: '反映項目の取得に失敗しました',
        schema: visitReflectedFieldsResponseSchema,
      });
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
        <PatientFieldRevisionList items={items} showSource={false} />
      </CardContent>
    </Card>
  );
}
