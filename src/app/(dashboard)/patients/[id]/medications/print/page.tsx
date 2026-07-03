'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { getPatientMedicationPrintShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { PrintPageToolbar } from '@/components/features/workflow/print-page-toolbar';
import { PrintLayout } from '@/components/features/reports/print-layout';
import { buttonVariants } from '@/components/ui/button';
import { Loading } from '@/components/ui/loading';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { buildPatientHref } from '@/lib/patient/navigation';
import { formatDateLabel } from '@/lib/ui/date-format';

type PatientResponse = {
  id: string;
  name: string;
  name_kana: string | null;
  birth_date: string | null;
};

type MedicationProfile = {
  id: string;
  drug_name: string;
  dose: string | null;
  frequency: string | null;
  start_date: string | null;
  end_date: string | null;
  prescriber: string | null;
  is_current: boolean;
  source: string | null;
};

type MedicationProfileResponse = {
  data: MedicationProfile[];
};

export default function MedicationPrintPage() {
  const params = useParams<{ id: string }>();
  const orgId = useOrgId();
  const isBootstrappingOrg = !orgId;
  const patientId = typeof params.id === 'string' ? params.id : '';

  const orgQuery = useQuery<{ name: string }>({
    queryKey: ['me-org', orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const response = await fetch('/api/me/org', {
        headers: buildOrgHeaders(orgId),
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('薬局情報を取得できませんでした');
      return response.json();
    },
    staleTime: 60_000,
  });

  const patientQuery = useQuery<PatientResponse>({
    queryKey: ['patient-print', patientId, orgId],
    enabled: Boolean(patientId && orgId),
    queryFn: async () => {
      const response = await fetch(buildPatientApiPath(patientId), {
        headers: buildOrgHeaders(orgId),
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('患者情報を取得できませんでした');
      return response.json();
    },
  });

  const medicationQuery = useQuery<MedicationProfileResponse>({
    queryKey: ['medication-print', patientId, orgId],
    enabled: Boolean(patientId && orgId),
    queryFn: async () => {
      const params = new URLSearchParams({
        patient_id: patientId,
        is_current: 'true',
        limit: '200',
      });
      const response = await fetch(`/api/medication-profiles?${params.toString()}`, {
        headers: buildOrgHeaders(orgId),
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('服薬一覧を取得できませんでした');
      return response.json();
    },
  });

  const org = orgQuery.data;
  const patient = patientQuery.data;
  const profiles = medicationQuery.data?.data ?? [];
  const isLoadingPrintData =
    orgQuery.isLoading || patientQuery.isLoading || medicationQuery.isLoading;
  const hasPrintData = Boolean(org && patient);
  const ready = hasPrintData && !isLoadingPrintData;

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => window.print(), 150);
    return () => window.clearTimeout(timer);
  }, [ready]);

  if (isBootstrappingOrg || isLoadingPrintData) {
    return <Loading />;
  }

  if (!org || !patient || orgQuery.error || patientQuery.error || medicationQuery.error) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <p className="text-sm text-destructive">印刷データを取得できませんでした。</p>
        <Link
          href={buildPatientHref(patientId, '/medications')}
          className={buttonVariants({ variant: 'outline' })}
        >
          戻る
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6 print:p-0">
      <PrintPageToolbar
        backHref={buildPatientHref(patientId, '/medications')}
        backLabel="服薬管理へ戻る"
        title="薬歴・服薬一覧 印刷ビュー"
        description="服薬中薬剤と処方履歴をまとめて印刷できます。"
        shortcuts={getPatientMedicationPrintShortcutLinks(patientId)}
      />

      <PrintLayout pharmacyName={org.name.trim() || 'PH-OS薬局'}>
        <div className="space-y-4 text-sm">
          <div className="border-b-2 border-black pb-2">
            <h1 className="text-center text-xl font-bold">薬歴・服薬一覧</h1>
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
                <td className="px-2 py-1">{formatDateLabel(patient.birth_date)}</td>
              </tr>
            </tbody>
          </table>

          <section>
            <h2 className="mb-1 bg-gray-800 px-2 py-1 text-sm font-bold text-white">
              【服薬中薬剤】
            </h2>
            <table className="w-full border border-gray-400 text-xs">
              <thead>
                <tr>
                  <th className="bg-gray-100 px-2 py-1 text-left">薬剤名</th>
                  <th className="bg-gray-100 px-2 py-1 text-left">用量</th>
                  <th className="bg-gray-100 px-2 py-1 text-left">用法</th>
                  <th className="bg-gray-100 px-2 py-1 text-left">開始日</th>
                  <th className="bg-gray-100 px-2 py-1 text-left">終了日</th>
                  <th className="bg-gray-100 px-2 py-1 text-left">処方医</th>
                  <th className="bg-gray-100 px-2 py-1 text-left">状態</th>
                </tr>
              </thead>
              <tbody>
                {profiles.length > 0 ? (
                  profiles.map((profile) => (
                    <tr key={profile.id}>
                      <td className="px-2 py-1">{profile.drug_name}</td>
                      <td className="px-2 py-1 tabular-nums">{profile.dose ?? '—'}</td>
                      <td className="px-2 py-1">{profile.frequency ?? '—'}</td>
                      <td className="px-2 py-1 tabular-nums">
                        {formatDateLabel(profile.start_date)}
                      </td>
                      <td className="px-2 py-1 tabular-nums">
                        {formatDateLabel(profile.end_date)}
                      </td>
                      <td className="px-2 py-1">{profile.prescriber ?? '—'}</td>
                      <td className="px-2 py-1">{profile.is_current ? '服薬中' : '終了'}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-2 py-4 text-center text-muted-foreground">
                      印刷対象の服薬情報がありません。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </div>
      </PrintLayout>
    </div>
  );
}
