'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Printer } from 'lucide-react';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { getPatientVisitRecordPrintShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowBackLink } from '@/components/features/workflow/workflow-back-link';
import { PrintLayout } from '@/components/features/reports/print-layout';
import { Button, buttonVariants } from '@/components/ui/button';
import { Loading } from '@/components/ui/loading';
import { useOrgId } from '@/lib/hooks/use-org-id';

type PatientResponse = {
  data: {
    id: string;
    name: string;
    name_kana: string | null;
    birth_date: string | null;
  };
};

type VisitRecordRow = {
  id: string;
  visit_date: string;
  outcome_status: string;
  soap_subjective: string | null;
  soap_objective: string | null;
  soap_assessment: string | null;
  soap_plan: string | null;
  next_visit_suggestion_date: string | null;
  created_at: string;
  updated_at: string;
  schedule: {
    visit_type: string;
    scheduled_date: string;
  } | null;
};

type VisitRecordResponse = {
  data: VisitRecordRow[];
};

const outcomeLabels: Record<string, string> = {
  completed: '完了',
  revisit_needed: '再訪必要',
  postponed: '延期',
  cancelled: 'キャンセル',
  delivery_only: '投薬のみ',
  completed_with_issue: '完了（課題あり）',
};

const visitTypeLabels: Record<string, string> = {
  initial: '初回',
  regular: '定期',
  temporary: '臨時',
  revisit: '再訪',
  delivery_only: '配薬のみ',
  emergency: '緊急',
  physician_co_visit: '医師同行',
};

function formatDate(value: string | null, withTime = false) {
  if (!value) return '—';
  return format(parseISO(value), withTime ? 'yyyy/MM/dd HH:mm' : 'yyyy/MM/dd', {
    locale: ja,
  });
}

export default function PatientVisitRecordsPrintPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const orgId = useOrgId();
  const patientId = typeof params.id === 'string' ? params.id : '';
  const dateFrom = searchParams.get('dateFrom') ?? '';
  const dateTo = searchParams.get('dateTo') ?? '';

  const patientQuery = useQuery<PatientResponse>({
    queryKey: ['visit-record-print-patient', patientId, orgId],
    enabled: Boolean(patientId && orgId),
    queryFn: async () => {
      const response = await fetch(`/api/patients/${patientId}`, {
        headers: { 'x-org-id': orgId },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('患者情報を取得できませんでした');
      return response.json();
    },
  });

  const recordsQuery = useQuery<VisitRecordResponse>({
    queryKey: ['visit-record-print', patientId, orgId, dateFrom, dateTo],
    enabled: Boolean(patientId && orgId),
    queryFn: async () => {
      const query = new URLSearchParams({
        patient_id: patientId,
        limit: '200',
      });
      if (dateFrom) query.set('date_from', dateFrom);
      if (dateTo) query.set('date_to', dateTo);

      const response = await fetch(`/api/visit-records?${query.toString()}`, {
        headers: { 'x-org-id': orgId },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('訪問記録を取得できませんでした');
      return response.json();
    },
  });

  const patient = patientQuery.data?.data;
  const records = recordsQuery.data?.data ?? [];
  const ready = Boolean(patient) && !patientQuery.isLoading && !recordsQuery.isLoading;

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => window.print(), 150);
    return () => window.clearTimeout(timer);
  }, [ready]);

  if (patientQuery.isLoading || recordsQuery.isLoading) {
    return <Loading />;
  }

  if (!patient || patientQuery.error || recordsQuery.error) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <p className="text-sm text-destructive">印刷データを取得できませんでした。</p>
        <Link href={`/patients/${patientId}`} className={buttonVariants({ variant: 'outline' })}>
          戻る
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6 print:p-0">
      <div className="mb-4 space-y-3 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <WorkflowBackLink href={`/patients/${patientId}`} label="患者詳細へ戻る" />
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="mr-1.5 size-4" aria-hidden="true" />
            印刷
          </Button>
        </div>
        <PageShortcutLinks links={getPatientVisitRecordPrintShortcutLinks(patientId)} />
      </div>

      <PrintLayout pharmacyName="CareViaX薬局">
        <div className="space-y-4 text-sm">
          <div className="border-b-2 border-black pb-2">
            <h1 className="text-center text-xl font-bold">訪問記録一覧（薬歴）</h1>
          </div>

          <table className="w-full border border-gray-400 text-xs">
            <tbody>
              <tr>
                <th className="w-1/5 bg-gray-100 px-2 py-1 text-left">患者名</th>
                <td className="px-2 py-1">{patient.name}</td>
                <th className="w-1/5 bg-gray-100 px-2 py-1 text-left">患者ID</th>
                <td className="px-2 py-1">{patient.id}</td>
              </tr>
              <tr>
                <th className="bg-gray-100 px-2 py-1 text-left">フリガナ</th>
                <td className="px-2 py-1">{patient.name_kana ?? '—'}</td>
                <th className="bg-gray-100 px-2 py-1 text-left">生年月日</th>
                <td className="px-2 py-1">{formatDate(patient.birth_date)}</td>
              </tr>
              <tr>
                <th className="bg-gray-100 px-2 py-1 text-left">対象期間</th>
                <td colSpan={3} className="px-2 py-1">
                  {dateFrom || dateTo ? `${dateFrom || '開始指定なし'} - ${dateTo || '終了指定なし'}` : '全期間'}
                </td>
              </tr>
            </tbody>
          </table>

          <section>
            <h2 className="mb-1 bg-gray-800 px-2 py-1 text-sm font-bold text-white">
              【訪問記録一覧】
            </h2>
            <table className="w-full border border-gray-400 text-xs">
              <thead>
                <tr>
                  <th className="bg-gray-100 px-2 py-1 text-left">訪問日</th>
                  <th className="bg-gray-100 px-2 py-1 text-left">訪問タイプ</th>
                  <th className="bg-gray-100 px-2 py-1 text-left">結果</th>
                  <th className="bg-gray-100 px-2 py-1 text-left">次回提案</th>
                  <th className="bg-gray-100 px-2 py-1 text-left">更新日時</th>
                </tr>
              </thead>
              <tbody>
                {records.length > 0 ? (
                  records.map((record) => (
                    <tr key={record.id}>
                      <td className="px-2 py-1">{formatDate(record.visit_date)}</td>
                      <td className="px-2 py-1">
                        {record.schedule
                          ? (visitTypeLabels[record.schedule.visit_type] ?? record.schedule.visit_type)
                          : '—'}
                      </td>
                      <td className="px-2 py-1">
                        {outcomeLabels[record.outcome_status] ?? record.outcome_status}
                      </td>
                      <td className="px-2 py-1">{formatDate(record.next_visit_suggestion_date)}</td>
                      <td className="px-2 py-1">{formatDate(record.updated_at, true)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-2 py-4 text-center text-muted-foreground">
                      印刷対象の訪問記録がありません。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          {records.map((record, index) => (
            <section key={record.id}>
              <h2 className="mb-1 bg-gray-800 px-2 py-1 text-sm font-bold text-white">
                【{index + 1}. {formatDate(record.visit_date)} / {outcomeLabels[record.outcome_status] ?? record.outcome_status}】
              </h2>
              <div className="space-y-2 border border-gray-400 px-3 py-2 text-xs">
                <p><span className="font-semibold">S:</span> {record.soap_subjective ?? '記録なし'}</p>
                <p><span className="font-semibold">O:</span> {record.soap_objective ?? '記録なし'}</p>
                <p><span className="font-semibold">A:</span> {record.soap_assessment ?? '記録なし'}</p>
                <p><span className="font-semibold">P:</span> {record.soap_plan ?? '記録なし'}</p>
              </div>
            </section>
          ))}
        </div>
      </PrintLayout>
    </div>
  );
}
