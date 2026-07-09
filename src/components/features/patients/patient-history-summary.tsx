'use client';

import { useId, useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Clock, FileText, History, Pill } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { OUTCOME_LABELS } from '@/lib/constants/visit';
import { formatDateLabel as formatDate } from '@/lib/ui/date-format';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { buildPatientHref } from '@/lib/patient/navigation';
import { buildPrescriptionHref } from '@/lib/prescriptions/navigation';
import { buildVisitHref } from '@/lib/visits/navigation';

type PrescriptionSummaryLine = {
  drug_name: string;
  dose?: string | null;
};

type PrescriptionSummaryItem = {
  id: string;
  prescribed_date: string;
  prescriber_name: string | null;
  lines: PrescriptionSummaryLine[];
};

type VisitSummaryItem = {
  id: string;
  visit_date: string;
  outcome_status: string;
  soap_assessment: string | null;
  next_visit_suggestion_date: string | null;
};

type PatientPrescriptionsResponse = {
  data: PrescriptionSummaryItem[];
};

type PatientVisitsResponse = {
  data: VisitSummaryItem[];
};

type PatientHistorySummaryProps = {
  patientId: string;
  excludePrescriptionIntakeId?: string;
  excludeVisitRecordId?: string;
  className?: string;
};

function buildDrugSummary(lines: PrescriptionSummaryLine[]) {
  if (lines.length === 0) return '薬剤明細なし';
  const visible = lines.slice(0, 2).map((line) => line.drug_name);
  const rest = lines.length - visible.length;
  return `${visible.join('、')}${rest > 0 ? ` 他${rest}剤` : ''}`;
}

export function PatientHistorySummary({
  patientId,
  excludePrescriptionIntakeId,
  excludeVisitRecordId,
  className,
}: PatientHistorySummaryProps) {
  const orgId = useOrgId();
  const headingId = useId();

  const prescriptionsQuery = useQuery({
    queryKey: ['patient-history-summary-prescriptions', orgId, patientId],
    queryFn: async () => {
      const response = await fetch(`${buildPatientApiPath(patientId, '/prescriptions')}?limit=5`, {
        headers: buildOrgHeaders(orgId),
      });
      const payload = await readApiJson<{ data: PatientPrescriptionsResponse }>(
        response,
        '処方履歴の取得に失敗しました',
      );
      return payload.data;
    },
    enabled: Boolean(orgId && patientId),
  });

  const visitsQuery = useQuery({
    queryKey: ['patient-history-summary-visits', orgId, patientId],
    queryFn: async () => {
      const params = new URLSearchParams({ patient_id: patientId, limit: '5' });
      const response = await fetch(`/api/visit-records?${params.toString()}`, {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<PatientVisitsResponse>(response, '訪問履歴の取得に失敗しました');
    },
    enabled: Boolean(orgId && patientId),
  });

  const previousPrescription = useMemo(
    () =>
      prescriptionsQuery.data?.data.find((item) => item.id !== excludePrescriptionIntakeId) ?? null,
    [excludePrescriptionIntakeId, prescriptionsQuery.data],
  );
  const previousVisit = useMemo(
    () => visitsQuery.data?.data.find((item) => item.id !== excludeVisitRecordId) ?? null,
    [excludeVisitRecordId, visitsQuery.data],
  );
  const isLoading = prescriptionsQuery.isLoading || visitsQuery.isLoading;
  const hasError = Boolean(prescriptionsQuery.error || visitsQuery.error);

  return (
    <section
      className={className ?? 'border-b border-border/70 bg-muted/10 px-3 py-2'}
      aria-labelledby={headingId}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <h2 id={headingId} className="text-xs font-semibold text-foreground">
            直近過去歴サマリー
          </h2>
          <p className="text-[11px] text-muted-foreground">
            今回分を除いた直近の処方・訪問を同じ画面内で確認します。
          </p>
        </div>
        {isLoading ? (
          <Badge variant="outline" className="gap-1 text-[10px]">
            <Clock className="size-3" aria-hidden="true" />
            読込中
          </Badge>
        ) : null}
      </div>

      {hasError ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">
          過去歴の一部を取得できませんでした。患者別履歴リンクから確認してください。
        </p>
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">
          <div className="rounded-lg border border-border/70 bg-card px-2.5 py-2">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Pill className="size-3.5 text-primary" aria-hidden="true" />
              過去処方
            </div>
            {previousPrescription ? (
              <div className="space-y-0.5 text-[11px]">
                <Link
                  href={buildPrescriptionHref(previousPrescription.id)}
                  className="inline-flex min-h-11 min-w-11 items-center font-medium text-primary hover:underline"
                >
                  {formatDate(previousPrescription.prescribed_date)}
                </Link>
                <p className="line-clamp-1 text-muted-foreground">
                  {buildDrugSummary(previousPrescription.lines)}
                </p>
                <p className="text-muted-foreground">
                  {previousPrescription.prescriber_name ?? '処方医未登録'}
                </p>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">過去処方はありません</p>
            )}
          </div>

          <div className="rounded-lg border border-border/70 bg-card px-2.5 py-2">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <History className="size-3.5 text-primary" aria-hidden="true" />
              過去訪問
            </div>
            {previousVisit ? (
              <div className="space-y-0.5 text-[11px]">
                <Link
                  href={buildVisitHref(previousVisit.id)}
                  className="inline-flex min-h-11 min-w-11 items-center font-medium text-primary hover:underline"
                >
                  {formatDate(previousVisit.visit_date)}
                </Link>
                <p className="text-muted-foreground">
                  結果:{' '}
                  {OUTCOME_LABELS[previousVisit.outcome_status] ?? previousVisit.outcome_status}
                </p>
                <p className="line-clamp-1 text-muted-foreground">
                  {previousVisit.soap_assessment ? (
                    previousVisit.soap_assessment
                  ) : previousVisit.next_visit_suggestion_date ? (
                    <>次回提案 {formatDate(previousVisit.next_visit_suggestion_date)}</>
                  ) : (
                    '特記事項なし'
                  )}
                </p>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">過去訪問はありません</p>
            )}
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
        <Link
          href={buildPatientHref(patientId, '/prescriptions')}
          className="inline-flex min-h-11 min-w-11 items-center gap-1 text-primary hover:underline"
        >
          <FileText className="size-3" aria-hidden="true" />
          処方履歴をすべて見る
        </Link>
        <Link
          href={buildPatientHref(patientId, '#card-recent-activities')}
          className="inline-flex min-h-11 min-w-11 items-center gap-1 text-primary hover:underline"
        >
          <History className="size-3" aria-hidden="true" />
          訪問履歴をすべて見る
        </Link>
      </div>
    </section>
  );
}
