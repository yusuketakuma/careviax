'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { ChevronLeft, Printer } from 'lucide-react';
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

function formatDate(value: string | null) {
  if (!value) return '—';
  return format(parseISO(value), 'yyyy/MM/dd', { locale: ja });
}

export default function MedicationPrintPage() {
  const params = useParams<{ id: string }>();
  const orgId = useOrgId();
  const patientId = typeof params.id === 'string' ? params.id : '';

  const patientQuery = useQuery<PatientResponse>({
    queryKey: ['patient-print', patientId, orgId],
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

  const medicationQuery = useQuery<MedicationProfileResponse>({
    queryKey: ['medication-print', patientId, orgId],
    enabled: Boolean(patientId && orgId),
    queryFn: async () => {
      const response = await fetch(
        `/api/medication-profiles?patient_id=${patientId}&is_current=true&limit=200`,
        {
          headers: { 'x-org-id': orgId },
          cache: 'no-store',
        }
      );
      if (!response.ok) throw new Error('服薬一覧を取得できませんでした');
      return response.json();
    },
  });

  const patient = patientQuery.data?.data;
  const profiles = medicationQuery.data?.data ?? [];
  const ready = Boolean(patient) && !patientQuery.isLoading && !medicationQuery.isLoading;

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => window.print(), 150);
    return () => window.clearTimeout(timer);
  }, [ready]);

  if (patientQuery.isLoading || medicationQuery.isLoading) {
    return <Loading />;
  }

  if (!patient || patientQuery.error || medicationQuery.error) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <p className="text-sm text-destructive">印刷データを取得できませんでした。</p>
        <Link
          href={`/patients/${patientId}/medications`}
          className={buttonVariants({ variant: 'outline' })}
        >
          戻る
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6 print:p-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link
          href={`/patients/${patientId}/medications`}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          <ChevronLeft className="mr-1.5 size-4" aria-hidden="true" />
          戻る
        </Link>
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="mr-1.5 size-4" aria-hidden="true" />
          印刷
        </Button>
      </div>

      <PrintLayout pharmacyName="CareViaX薬局">
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
                <td className="px-2 py-1">{formatDate(patient.birth_date)}</td>
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
                      <td className="px-2 py-1">{profile.dose ?? '—'}</td>
                      <td className="px-2 py-1">{profile.frequency ?? '—'}</td>
                      <td className="px-2 py-1">{formatDate(profile.start_date)}</td>
                      <td className="px-2 py-1">{formatDate(profile.end_date)}</td>
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
