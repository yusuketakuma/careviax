'use client';

import { useId } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { FileText, History, Pill } from 'lucide-react';
import { SegmentError, SegmentLoading, SegmentStaleBanner } from '@/components/ui/segment-state';
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useStaleAfterRefetchError } from '@/lib/hooks/use-stale-after-refetch-error';
import { OUTCOME_LABELS } from '@/lib/constants/visit';
import { formatDateLabel as formatDate } from '@/lib/ui/date-format';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { buildPatientHref } from '@/lib/patient/navigation';
import { buildPrescriptionHref } from '@/lib/prescriptions/navigation';
import { buildVisitHref } from '@/lib/visits/navigation';
import {
  patientHistoryPrescriptionsResponseSchema,
  patientHistoryVisitsResponseSchema,
} from './patient-history-summary-response-schema';

type PrescriptionSummaryLine = {
  drug_name: string;
  dose?: string | null;
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
      return readApiJson(response, {
        fallbackMessage: '処方履歴の取得に失敗しました',
        schema: patientHistoryPrescriptionsResponseSchema,
      });
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
      return readApiJson(response, {
        fallbackMessage: '訪問履歴の取得に失敗しました',
        schema: patientHistoryVisitsResponseSchema,
      });
    },
    enabled: Boolean(orgId && patientId),
  });

  // Both endpoints are capped at five rows; direct derivation is cheaper and clearer than
  // memo bookkeeping for these bounded arrays.
  const previousPrescription =
    prescriptionsQuery.data?.data.find((item) => item.id !== excludePrescriptionIntakeId) ?? null;
  const previousVisit =
    visitsQuery.data?.data.find((item) => item.id !== excludeVisitRecordId) ?? null;
  const prescriptionsState = useStaleAfterRefetchError(prescriptionsQuery);
  const visitsState = useStaleAfterRefetchError(visitsQuery);

  return (
    <section
      className={className ?? 'border-b border-border/70 bg-muted/10 px-3 py-2'}
      aria-labelledby={headingId}
    >
      <div className="mb-2">
        <div>
          <h2 id={headingId} className="text-sm font-semibold leading-5 text-foreground">
            直近過去歴サマリー
          </h2>
          <p className="text-xs leading-5 text-muted-foreground">
            今回分を除いた直近の処方・訪問を同じ画面内で確認します。
          </p>
        </div>
      </div>

      <div className="grid gap-2 lg:grid-cols-2">
        {prescriptionsState.isInitialLoading ? (
          <SegmentLoading
            label="過去処方を読み込み中"
            description="直近の処方を確認しています。"
            rows={2}
            cols={1}
            size="compact"
          />
        ) : prescriptionsState.isInitialError ? (
          <SegmentError
            title="過去処方を表示できません"
            cause="処方履歴を取得できませんでした。"
            nextAction="通信状態を確認して再読み込みしてください。"
            onRetry={() => void prescriptionsQuery.refetch()}
            headingLevel={3}
            className="gap-3 px-3 py-4 [&_[data-slot=button]]:min-h-11 sm:[&_[data-slot=button]]:min-h-11"
          />
        ) : (
          <div className="rounded-lg border border-border/70 bg-card px-2.5 py-2">
            <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Pill className="size-3.5 text-primary" aria-hidden="true" />
              過去処方
            </h3>
            {prescriptionsState.isStaleAfterRefetchError ? (
              <SegmentStaleBanner
                title="前回取得した処方を表示中"
                description="最新の処方履歴を取得できませんでした。表示内容が古い可能性があります。"
                onRetry={() => void prescriptionsQuery.refetch()}
                className="mb-2 [&_[data-slot=button]]:min-h-11 sm:[&_[data-slot=button]]:min-h-11"
              />
            ) : null}
            {previousPrescription ? (
              <div className="space-y-0.5 text-xs leading-5">
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
              <p className="text-xs leading-5 text-muted-foreground">過去処方はありません</p>
            )}
          </div>
        )}

        {visitsState.isInitialLoading ? (
          <SegmentLoading
            label="過去訪問を読み込み中"
            description="直近の訪問記録を確認しています。"
            rows={2}
            cols={1}
            size="compact"
          />
        ) : visitsState.isInitialError ? (
          <SegmentError
            title="過去訪問を表示できません"
            cause="訪問履歴を取得できませんでした。"
            nextAction="通信状態を確認して再読み込みしてください。"
            onRetry={() => void visitsQuery.refetch()}
            headingLevel={3}
            className="gap-3 px-3 py-4 [&_[data-slot=button]]:min-h-11 sm:[&_[data-slot=button]]:min-h-11"
          />
        ) : (
          <div className="rounded-lg border border-border/70 bg-card px-2.5 py-2">
            <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <History className="size-3.5 text-primary" aria-hidden="true" />
              過去訪問
            </h3>
            {visitsState.isStaleAfterRefetchError ? (
              <SegmentStaleBanner
                title="前回取得した訪問を表示中"
                description="最新の訪問履歴を取得できませんでした。表示内容が古い可能性があります。"
                onRetry={() => void visitsQuery.refetch()}
                className="mb-2 [&_[data-slot=button]]:min-h-11 sm:[&_[data-slot=button]]:min-h-11"
              />
            ) : null}
            {previousVisit ? (
              <div className="space-y-0.5 text-xs leading-5">
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
              <p className="text-xs leading-5 text-muted-foreground">過去訪問はありません</p>
            )}
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-2 text-xs leading-5">
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
