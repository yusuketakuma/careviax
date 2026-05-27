'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { getManagementPlanPrintShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { sortedManagementPlanSections, SECTION_LABELS } from '@/lib/validations/management-plan';
import { PrintPageToolbar } from '@/components/features/workflow/print-page-toolbar';
import { PrintLayout } from '@/components/features/reports/print-layout';
import { buttonVariants } from '@/components/ui/button';
import { Loading } from '@/components/ui/loading';
import { useOrgId } from '@/lib/hooks/use-org-id';

type PatientResponse = {
  id: string;
  name: string;
};

type ManagementPlanResponse = {
  data: {
    id: string;
    title: string;
    summary: string | null;
    content: Record<string, unknown>;
    version: number;
    status: string;
    effective_from: string | null;
    next_review_date: string | null;
    approved_at: string | null;
    updated_at: string;
  };
};

function formatDate(value: string | null) {
  if (!value) return '—';
  return format(parseISO(value), 'yyyy/MM/dd', { locale: ja });
}

export default function ManagementPlanPrintPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const orgId = useOrgId();
  const isBootstrappingOrg = !orgId;
  const patientId = typeof params.id === 'string' ? params.id : '';
  const planId = searchParams.get('planId') ?? '';

  const patientQuery = useQuery<PatientResponse>({
    queryKey: ['management-plan-print-patient', patientId, orgId],
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

  const planQuery = useQuery<ManagementPlanResponse>({
    queryKey: ['management-plan-print', planId, orgId],
    enabled: Boolean(planId && orgId),
    queryFn: async () => {
      const response = await fetch(`/api/management-plans/${planId}`, {
        headers: { 'x-org-id': orgId },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('管理計画書を取得できませんでした');
      return response.json();
    },
  });

  const patient = patientQuery.data;
  const plan = planQuery.data?.data;
  const ready = Boolean(patient && plan) && !patientQuery.isLoading && !planQuery.isLoading;

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => window.print(), 150);
    return () => window.clearTimeout(timer);
  }, [ready]);

  if (isBootstrappingOrg || patientQuery.isLoading || planQuery.isLoading) {
    return <Loading />;
  }

  if (!patient || !plan || patientQuery.error || planQuery.error) {
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
      <PrintPageToolbar
        backHref={`/patients/${patientId}`}
        backLabel="患者詳細へ戻る"
        title="管理計画書 印刷ビュー"
        description="訪問薬剤管理指導計画書をA4印刷向けに確認できます。"
        shortcuts={getManagementPlanPrintShortcutLinks(patientId)}
      />

      <PrintLayout pharmacyName="PH-OS薬局">
        <div className="space-y-4 text-sm">
          <div className="border-b-2 border-black pb-2">
            <h1 className="text-center text-xl font-bold">訪問薬剤管理指導計画書</h1>
          </div>

          <table className="w-full border border-gray-400 text-xs">
            <tbody>
              <tr>
                <th className="w-1/5 bg-gray-100 px-2 py-1 text-left">患者名</th>
                <td className="px-2 py-1">{patient.name}</td>
                <th className="w-1/5 bg-gray-100 px-2 py-1 text-left">版数</th>
                <td className="px-2 py-1">v{plan.version}</td>
              </tr>
              <tr>
                <th className="bg-gray-100 px-2 py-1 text-left">適用開始日</th>
                <td className="px-2 py-1">{formatDate(plan.effective_from)}</td>
                <th className="bg-gray-100 px-2 py-1 text-left">次回見直し日</th>
                <td className="px-2 py-1">{formatDate(plan.next_review_date)}</td>
              </tr>
              <tr>
                <th className="bg-gray-100 px-2 py-1 text-left">承認日</th>
                <td className="px-2 py-1">{formatDate(plan.approved_at)}</td>
                <th className="bg-gray-100 px-2 py-1 text-left">状態</th>
                <td className="px-2 py-1">{plan.status}</td>
              </tr>
            </tbody>
          </table>

          <section>
            <h2 className="mb-1 bg-gray-800 px-2 py-1 text-sm font-bold text-white">
              【タイトル】
            </h2>
            <div className="border border-gray-400 px-3 py-2 text-xs">{plan.title}</div>
          </section>

          <section>
            <h2 className="mb-1 bg-gray-800 px-2 py-1 text-sm font-bold text-white">
              【要約】
            </h2>
            <div className="min-h-[48px] border border-gray-400 px-3 py-2 text-xs whitespace-pre-wrap">
              {plan.summary ?? '—'}
            </div>
          </section>

          {sortedManagementPlanSections(plan.content).map(({ key, label, value }) => (
            <section key={key}>
              <h2 className="mb-1 bg-gray-800 px-2 py-1 text-sm font-bold text-white">
                【{SECTION_LABELS[key] ?? label}】
              </h2>
              {Array.isArray(value) ? (
                value.length === 0 ? (
                  <div className="border border-gray-400 px-3 py-2 text-xs text-gray-400">—</div>
                ) : (
                  <ul className="border border-gray-400 px-3 py-2 text-xs space-y-1">
                    {(value as unknown[]).map((item, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-gray-500">•</span>
                        <span className="whitespace-pre-wrap">{String(item)}</span>
                      </li>
                    ))}
                  </ul>
                )
              ) : (
                <div className="min-h-[48px] border border-gray-400 px-3 py-2 text-xs whitespace-pre-wrap">
                  {value != null && value !== '' ? String(value) : '—'}
                </div>
              )}
            </section>
          ))}
        </div>
      </PrintLayout>
    </div>
  );
}
