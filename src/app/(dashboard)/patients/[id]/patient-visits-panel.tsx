'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { FileDown, Printer } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loading } from '@/components/ui/loading';
import { HomeCareFeatureBoard } from '@/components/home-care/home-care-feature-board';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { fetchPatientVisitRecordsWindow } from './patient-visit-records.helpers';
import type { PatientVisitsSnapshot } from './patient-detail.types';

export function PatientVisitsPanel({
  patientId,
  medicalInsuranceNumber,
  careInsuranceNumber,
  enabled,
}: {
  patientId: string;
  medicalInsuranceNumber: string | null;
  careInsuranceNumber: string | null;
  enabled: boolean;
}) {
  const orgId = useOrgId();
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const hasDateFilter = Boolean(dateFrom || dateTo);

  const visitsQuery = useQuery<PatientVisitsSnapshot>({
    queryKey: ['patient-visits-panel', patientId, orgId],
    enabled: Boolean(orgId && patientId && enabled),
    queryFn: async () => {
      const response = await fetch(`/api/patients/${patientId}/visits`, {
        headers: { 'x-org-id': orgId ?? '' },
      });
      if (!response.ok) {
        throw new Error('訪問情報の取得に失敗しました');
      }
      return response.json();
    },
  });

  const visitRecordQuery = useQuery<{ data: PatientVisitsSnapshot['visit_records'] }>({
    queryKey: ['patient-visit-records', patientId, orgId, dateFrom, dateTo],
    enabled: Boolean(patientId && orgId && enabled && visitsQuery.data),
    ...(hasDateFilter || !visitsQuery.data
      ? {}
      : { initialData: { data: visitsQuery.data.visit_records } }),
    queryFn: async () => {
      const data = await fetchPatientVisitRecordsWindow<PatientVisitsSnapshot['visit_records'][number]>({
        orgId,
        patientId,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      return { data };
    },
  });

  if (!orgId) {
    return <Loading label="訪問情報を読み込み中..." />;
  }

  if (visitsQuery.isLoading) {
    return <Loading label="訪問情報を読み込み中..." />;
  }

  if (visitsQuery.error instanceof Error || !visitsQuery.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">訪問</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">
            {visitsQuery.error instanceof Error
              ? visitsQuery.error.message
              : '訪問情報の取得に失敗しました'}
          </p>
        </CardContent>
      </Card>
    );
  }

  const { monthly_visit_count, visit_schedules, home_care_feature_summary } = visitsQuery.data;
  const visibleVisitRecords = visitRecordQuery.data?.data ?? [];
  const exportQuery = new URLSearchParams();
  if (dateFrom) exportQuery.set('date_from', dateFrom);
  if (dateTo) exportQuery.set('date_to', dateTo);
  const exportHref = `/api/patients/${patientId}/visit-records/pdf${exportQuery.size > 0 ? `?${exportQuery.toString()}` : ''}`;
  const printHref = `/patients/${patientId}/visit-records/print${
    dateFrom || dateTo
      ? `?${new URLSearchParams({
          ...(dateFrom ? { dateFrom } : {}),
          ...(dateTo ? { dateTo } : {}),
        }).toString()}`
      : ''
  }`;
  const monthlyCountBadges = [
    ...(medicalInsuranceNumber ? [{ label: '医療', limit: 4 }] : []),
    ...(careInsuranceNumber ? [{ label: '介護', limit: 2 }] : []),
  ];

  return (
    <div className="space-y-4">
      <HomeCareFeatureBoard
        summary={home_care_feature_summary}
        title="訪問支援サマリー"
        description="この患者で優先して整備・確認すべき訪問支援項目を一覧化しています。"
        compact
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">直近の訪問予定</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {monthlyCountBadges.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {monthlyCountBadges.map((badge) => (
                  <Badge
                    key={badge.label}
                    variant={monthly_visit_count > badge.limit ? 'destructive' : 'outline'}
                  >
                    今月 {badge.label} {monthly_visit_count}/{badge.limit} 回
                  </Badge>
                ))}
              </div>
            ) : null}
            {visit_schedules.length === 0 ? (
              <p className="text-sm text-muted-foreground">訪問予定はありません</p>
            ) : (
              visit_schedules.map((item) => (
                <div key={item.id} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">
                        {format(new Date(item.scheduled_date), 'yyyy年M月d日(E)', {
                          locale: ja,
                        })}
                      </p>
                      <p className="text-muted-foreground">
                        状態: {item.schedule_status}
                        {item.route_order ? ` / ルート順 ${item.route_order}` : ''}
                      </p>
                    </div>
                    <Badge variant={item.confirmed_at ? 'default' : 'outline'}>
                      {item.confirmed_at ? '確定済み' : '未確定'}
                    </Badge>
                  </div>
                  {item.visit_record ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      記録: {item.visit_record.outcome_status}
                    </p>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <CardTitle className="text-base">訪問記録</CardTitle>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={exportHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  <FileDown className="mr-1.5 size-3.5" aria-hidden="true" />
                  PDF
                </Link>
                <Link
                  href={printHref}
                  target="_blank"
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  <Printer className="mr-1.5 size-3.5" aria-hidden="true" />
                  印刷
                </Link>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-3">
              <div className="space-y-1">
                <Label htmlFor="patient-visit-date-from" className="text-xs">
                  開始日
                </Label>
                <Input
                  id="patient-visit-date-from"
                  type="date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                  className="h-8 w-40 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="patient-visit-date-to" className="text-xs">
                  終了日
                </Label>
                <Input
                  id="patient-visit-date-to"
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                  className="h-8 w-40 text-sm"
                />
              </div>
            </div>
            {visitRecordQuery.isLoading ? (
              <Loading label="訪問記録を読み込み中..." />
            ) : visibleVisitRecords.length === 0 ? (
              <p className="text-sm text-muted-foreground">訪問記録はありません</p>
            ) : (
              visibleVisitRecords.map((item) => (
                <div key={item.id} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link
                        href={`/visits/${item.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {format(new Date(item.visit_date ?? item.created_at), 'yyyy年M月d日(E)', {
                          locale: ja,
                        })}
                      </Link>
                      <p className="text-muted-foreground">結果: {item.outcome_status}</p>
                    </div>
                    {item.next_visit_suggestion_date ? (
                      <Badge variant="outline">
                        次回提案{' '}
                        {format(new Date(item.next_visit_suggestion_date), 'M/d', {
                          locale: ja,
                        })}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {item.revisit_reason ??
                      item.postpone_reason ??
                      item.cancellation_reason ??
                      '特記事項なし'}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
