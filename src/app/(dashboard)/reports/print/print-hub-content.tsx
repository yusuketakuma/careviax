'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Label } from '@/components/ui/label';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { buildSetPlanApiPath } from '@/lib/dispensing/api-paths';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { buildCareReportApiPath, buildCareReportPrintAuditApiPath } from '@/lib/reports/api-paths';
import { messageFromError, SafeClientMessageError } from '@/lib/utils/error-message';
import { buildPatientHeaderSummaryResponseSchema } from '@/app/(dashboard)/patients/[id]/card-workspace-response-schemas';
import {
  careReportPrintAuditResponseSchema,
  type CareReportPrintAuditResponse,
} from '@/lib/reports/care-report-print-audit-contract';
import { cn } from '@/lib/utils';
import {
  buildDocumentReceiptRows,
  buildFirstVisitDocumentPrintSummary,
  buildMedicationCalendarDocument,
  buildMedicationLabelCards,
  buildSetInstructionDocument,
  buildVisitReportDocument,
  DEFAULT_PRINT_OUTPUT_SETTINGS,
  firstVisitPrintBlockReason,
  formatPrintDate,
  parsePrintDocumentType,
  pickIntakeForCycle,
  PRINT_DOCUMENT_TYPES,
  printDocumentTypeLabel,
  resolvePrintTargetSelection,
  summarizeFirstVisitPrintReadiness,
  type CareReportForPrint,
  type DocumentReceiptRow,
  type FirstVisitDocumentForPrint,
  type FirstVisitDocumentPrintSummary,
  type FirstVisitPrintReadinessSummary,
  type MedicationCalendarDocument,
  type MedicationLabelCard,
  type PrescriptionIntakeForPrint,
  type PrintDocumentTypeKey,
  type PrintOutputSettings,
  type SetInstructionDocument,
  type ValidPrintTargetSelection,
  type VisitReportDocument,
} from './print-hub.shared';
import {
  buildPrintHubCareReportResponseSchema,
  buildPrintHubPatientDocumentsResponseSchema,
  buildPrintHubPrescriptionsPageSchema,
  buildPrintHubSetPlanResponseSchema,
} from './print-hub-response-schemas';

/**
 * p0_47(帳票・印刷プレビュー)/reports/print。
 * 左「印刷するもの」(帳票カード)/ 中央「プレビュー」(A4 縦の白紙カード)/
 * 右「出力設定」(チェック 4 つ + 印刷する)の 3 カラム。
 * 印刷時はプレビューの帳票のみを出力する(他カラムとカード枠は print:hidden)。
 */
const PRINT_DISABLED_REASON_ID = 'print-submit-disabled-reason';

// ─── データ取得 ──────────────────────────────────────────────────────────────

const PRINT_HUB_PRESCRIPTION_PAGE_LIMIT = 20;
const PRINT_HUB_PRESCRIPTION_MAX_PAGES = 5;

type PrintTargetSummary = {
  patientName: string;
  birthDateLabel: string;
  documentTypeLabel: string;
  sourceId: string;
  statusLabel: string;
};

class FirstVisitPrintVersionConflictError extends Error {}
const FIRST_VISIT_DOCUMENT_VERSION_CONFLICT_REASON =
  'first_visit_document_version_conflict';

async function recordFirstVisitPrintHistory({
  orgId,
  patientId,
  documents,
  saveCopy,
}: {
  orgId: string;
  patientId: string | null;
  documents: readonly FirstVisitDocumentForPrint[];
  saveCopy: boolean;
}) {
  if (!patientId) throw new Error('患者IDがないため初回文書の印刷履歴を記録できません');
  const res = await fetch('/api/first-visit-documents/print-batch', {
    method: 'POST',
    headers: buildOrgJsonHeaders(orgId),
    body: JSON.stringify({
      patient_id: patientId,
      documents: documents.map((document) => ({
        id: document.id,
        expected_updated_at: document.updated_at,
      })),
      save_copy: saveCopy,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (
      res.status === 409 &&
      body.details?.reason === FIRST_VISIT_DOCUMENT_VERSION_CONFLICT_REASON
    ) {
      throw new FirstVisitPrintVersionConflictError('初回文書の版が更新されました');
    }
    throw SafeClientMessageError.fromReviewed(
      '初回文書の印刷履歴を記録できませんでした。患者状態と印刷前チェックを確認してください。',
    );
  }
}

function documentTypeNeedsSetPlan(documentType: PrintDocumentTypeKey) {
  return (
    documentType === 'set_instruction' ||
    documentType === 'medication_calendar' ||
    documentType === 'medication_label'
  );
}

function documentTypeNeedsCareReports(documentType: PrintDocumentTypeKey) {
  return documentType === 'visit_report' || documentType === 'document_receipt';
}

function setPlanStatusLabel(plan: SetInstructionDocument | null, auditResult?: string) {
  if (!plan) return '対象未取得';
  switch (auditResult) {
    case 'approved':
      return '監査承認済み';
    case 'partial_approved':
      return '一部承認';
    case 'rejected':
      return '監査差戻し';
    default:
      return '監査未確定';
  }
}

function usePrintHubData(orgId: string, target: ValidPrintTargetSelection | null) {
  const documentType = target?.documentType ?? null;
  const patientId = target?.patientId ?? null;
  const resourceId = target?.resourceId ?? null;
  const needsSetPlan = documentType !== null && documentTypeNeedsSetPlan(documentType);
  const needsCareReport = documentType !== null && documentTypeNeedsCareReports(documentType);
  const needsFirstVisitDocument = documentType === 'first_visit_documents';

  const patientHeaderQuery = useQuery({
    queryKey: ['print-hub-patient-header', orgId, patientId],
    queryFn: async () => {
      if (!patientId) throw new Error('患者が一意に指定されていません');
      const res = await fetch(buildPatientApiPath(patientId, '/header-summary'), {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson(res, {
        schema: buildPatientHeaderSummaryResponseSchema(patientId),
        fallbackMessage: '患者識別情報の取得に失敗しました',
      });
    },
    enabled: !!orgId && !!target,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const setPlanQuery = useQuery({
    queryKey: ['print-hub-set-plan', orgId, patientId, resourceId],
    queryFn: async () => {
      if (!patientId || !resourceId) throw new Error('セットプランが一意に指定されていません');
      const res = await fetch(buildSetPlanApiPath(resourceId), {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson(res, {
        schema: buildPrintHubSetPlanResponseSchema(resourceId, patientId),
        fallbackMessage: 'セットプランの取得に失敗しました',
      });
    },
    enabled: !!orgId && !!target && needsSetPlan,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const plan = setPlanQuery.data ?? null;

  const prescriptionsQuery = useQuery({
    queryKey: ['print-hub-prescriptions', orgId, patientId, resourceId, plan?.cycle_id],
    queryFn: async () => {
      if (!patientId) throw new Error('患者IDがないため処方明細を取得できません');
      const intakes: PrescriptionIntakeForPrint[] = [];
      const seenIntakeIds = new Set<string>();
      const seenCursors = new Set<string>();
      let cursor: string | null = null;

      for (let page = 0; page < PRINT_HUB_PRESCRIPTION_MAX_PAGES; page += 1) {
        const params = new URLSearchParams({ limit: String(PRINT_HUB_PRESCRIPTION_PAGE_LIMIT) });
        if (cursor) params.set('cursor', cursor);
        const res = await fetch(
          `${buildPatientApiPath(patientId, '/prescriptions')}?${params.toString()}`,
          { headers: buildOrgHeaders(orgId) },
        );
        const payload = await readApiJson(res, {
          schema: buildPrintHubPrescriptionsPageSchema(patientId),
          fallbackMessage: '処方明細の取得に失敗しました',
        });
        for (const intake of payload.data) {
          if (seenIntakeIds.has(intake.id)) throw new Error('処方明細の取得に失敗しました');
          seenIntakeIds.add(intake.id);
          intakes.push(intake);
        }
        if (intakes.some((intake) => intake.cycle_id === plan?.cycle_id) || !payload.hasMore) {
          return { patient: payload.patient, data: intakes };
        }
        cursor = payload.nextCursor;
        if (!cursor || seenCursors.has(cursor)) throw new Error('処方明細の取得に失敗しました');
        seenCursors.add(cursor);
      }

      throw new Error('処方明細の取得件数が上限を超えました');
    },
    enabled: !!orgId && needsSetPlan && !!patientId && !!plan,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const careReportQuery = useQuery({
    queryKey: ['print-hub-care-report', orgId, patientId, resourceId],
    queryFn: async () => {
      if (!patientId || !resourceId) throw new Error('報告書が一意に指定されていません');
      const res = await fetch(buildCareReportApiPath(resourceId), {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson(res, {
        fallbackMessage: '報告書の取得に失敗しました',
        schema: buildPrintHubCareReportResponseSchema(resourceId, patientId),
      });
    },
    enabled: !!orgId && !!target && needsCareReport,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const patientDocumentsQuery = useQuery({
    queryKey: ['print-hub-patient-documents', orgId, patientId, resourceId],
    queryFn: async () => {
      if (!patientId) throw new Error('患者IDがないため患者文書を取得できません');
      const res = await fetch(buildPatientApiPath(patientId, '/documents'), {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson(res, {
        schema: buildPrintHubPatientDocumentsResponseSchema(patientId),
        fallbackMessage: '患者文書の取得に失敗しました',
      });
    },
    enabled: !!orgId && !!target && needsFirstVisitDocument,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const intake = pickIntakeForCycle(prescriptionsQuery.data?.data ?? [], plan?.cycle_id);
  const careReport = careReportQuery.data?.data ?? null;
  const selectedFirstVisitDocument =
    patientDocumentsQuery.data?.first_visit_documents.find(
      (document) => document.id === resourceId,
    ) ?? null;
  const firstVisitDocuments = selectedFirstVisitDocument ? [selectedFirstVisitDocument] : [];
  const patientHeader = patientHeaderQuery.data?.data ?? null;
  const setPlanPatient = plan?.cycle.case_.patient ?? null;
  const documentsPatient = patientDocumentsQuery.data?.patient ?? null;
  const hasIdentityMismatch = Boolean(
    patientHeader &&
    ((setPlanPatient && setPlanPatient.name !== patientHeader.name) ||
      (careReport &&
        (careReport.patient_name !== patientHeader.name ||
          careReport.patient_birth_date !== patientHeader.birth_date)) ||
      (documentsPatient && documentsPatient.name !== patientHeader.name)),
  );
  const missingExactIntake = Boolean(
    needsSetPlan && prescriptionsQuery.isSuccess && !prescriptionsQuery.isFetching && !intake,
  );
  const missingExactDocument = Boolean(
    needsFirstVisitDocument &&
    patientDocumentsQuery.isSuccess &&
    !patientDocumentsQuery.isFetching &&
    !selectedFirstVisitDocument,
  );
  const targetSummary: PrintTargetSummary | null =
    target &&
    patientHeader &&
    !hasIdentityMismatch &&
    !missingExactIntake &&
    !missingExactDocument &&
    ((needsSetPlan && plan) || (needsCareReport && careReport) || selectedFirstVisitDocument)
      ? {
          patientName: patientHeader.name,
          birthDateLabel: formatPrintDate(patientHeader.birth_date),
          documentTypeLabel: printDocumentTypeLabel(target.documentType),
          sourceId: target.resourceId,
          statusLabel: plan
            ? setPlanStatusLabel(buildSetInstructionDocument(plan, intake), plan.audits[0]?.result)
            : careReport
              ? '確定済み'
              : selectedFirstVisitDocument?.delivered_at
                ? '交付済み'
                : '未交付',
        }
      : null;
  const firstVisitPatientName = patientHeader?.name ?? '患者名未設定';
  const firstVisitPrintReadiness = patientDocumentsQuery.data?.print_readiness ?? null;

  const isLoading = Boolean(
    target &&
    (patientHeaderQuery.isPending ||
      (needsSetPlan && setPlanQuery.isPending) ||
      (needsCareReport && careReportQuery.isPending) ||
      (needsFirstVisitDocument && patientDocumentsQuery.isPending) ||
      (needsSetPlan && !!plan && prescriptionsQuery.isPending)),
  );
  const isError = Boolean(
    target &&
    (patientHeaderQuery.isError ||
      (needsSetPlan && setPlanQuery.isError) ||
      (needsCareReport && careReportQuery.isError) ||
      (needsFirstVisitDocument && patientDocumentsQuery.isError) ||
      (needsSetPlan && prescriptionsQuery.isError) ||
      hasIdentityMismatch ||
      missingExactIntake ||
      missingExactDocument),
  );
  const errorMessage = hasIdentityMismatch
    ? '患者識別情報が印刷元データと一致しません。対象画面から開き直してください。'
    : missingExactIntake
      ? '指定したセットプランの処方明細が見つかりません。セット内容を確認してください。'
      : missingExactDocument
        ? '指定した患者文書が見つかりません。患者文書画面から開き直してください。'
        : '帳票データの読み込みに失敗しました。対象画面から開き直すか再読み込みしてください。';

  return {
    plan,
    intake,
    reports: careReport ? [careReport] : [],
    firstVisitDocuments,
    firstVisitPatientName,
    firstVisitPrintReadiness,
    targetSummary,
    isLoading,
    isError,
    errorMessage,
  };
}

// ─── 帳票プレビュー(A4 内容)────────────────────────────────────────────────

function PrintTargetDetails({ target }: { target: PrintTargetSummary }) {
  return (
    <dl
      className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 border-y border-slate-300 py-2 text-xs leading-5 sm:grid-cols-2"
      data-testid="print-target-details"
    >
      <div>
        <dt className="text-muted-foreground">患者</dt>
        <dd className="font-medium text-foreground">{target.patientName} 様</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">生年月日</dt>
        <dd className="tabular-nums text-foreground">{target.birthDateLabel}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">文書種別</dt>
        <dd className="text-foreground">{target.documentTypeLabel}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">出力元 / 状態</dt>
        <dd className="break-all text-foreground">
          {target.sourceId} / {target.statusLabel}
        </dd>
      </div>
    </dl>
  );
}

/** A4 シート共通ヘッダ(発行元・出力日・QR プレースホルダ) */
function SheetHeader({
  title,
  settings,
  target,
}: {
  title: string;
  settings: PrintOutputSettings;
  target: PrintTargetSummary | null;
}) {
  return (
    <header>
      <div className="flex items-start justify-between gap-2">
        {settings.showFacilityName ? (
          <p className="text-[12px] leading-5 text-muted-foreground">
            発行元: CareViaX薬局 / 出力日: {new Date().toLocaleDateString('ja-JP')}
          </p>
        ) : (
          <span aria-hidden="true" />
        )}
        {settings.showQr && (
          <div
            aria-label="QRコード(プレースホルダ)"
            data-testid="print-sheet-qr"
            className="flex size-10 shrink-0 items-center justify-center border border-dashed border-slate-400 text-[12px] text-slate-400"
          >
            QR
          </div>
        )}
      </div>
      <h3 className="mt-3 text-xl font-bold tracking-wide text-foreground">{title}</h3>
      {target ? <PrintTargetDetails target={target} /> : null}
    </header>
  );
}

/** メタ行(患者名・期間など)。value が null の行は出さない */
function SheetMetaRows({ rows }: { rows: Array<{ label: string; value: string | null }> }) {
  const visibleRows = rows.filter((row) => row.value !== null);
  if (visibleRows.length === 0) return null;
  return (
    <dl className="mt-3 space-y-1 text-xs leading-5">
      {visibleRows.map((row) => (
        <div key={row.label} className="flex gap-2">
          <dt className="w-16 shrink-0 text-muted-foreground">{row.label}</dt>
          <dd className="text-foreground">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** データなし種別のサンプル枠(罫線のみ)+ 注記 */
function EmptySheetBody({ note }: { note: string }) {
  return (
    <div className="mt-4" data-testid="print-sheet-empty">
      <div className="space-y-9 border-y border-dashed border-slate-300 py-6">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="border-b border-slate-200" />
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">データなし(サンプル枠): {note}</p>
    </div>
  );
}

function LoadingSheetBody({
  title,
  settings,
  target,
}: {
  title: string;
  settings: PrintOutputSettings;
  target: PrintTargetSummary | null;
}) {
  return (
    <div>
      <SheetHeader title={title} settings={settings} target={target} />
      <div className="mt-4 rounded border border-dashed border-slate-300 px-4 py-10 text-center text-xs leading-6 text-muted-foreground">
        帳票の明細を確認しています。完了するとこのプレビューに反映されます。
      </div>
    </div>
  );
}

function SetInstructionSheet({
  document,
  settings,
  target,
}: {
  document: SetInstructionDocument | null;
  settings: PrintOutputSettings;
  target: PrintTargetSummary;
}) {
  return (
    <div>
      <SheetHeader title="セット指示書" settings={settings} target={target} />
      {!document ? (
        <EmptySheetBody note="印刷対象のセットプランが未登録です。" />
      ) : (
        <>
          <SheetMetaRows
            rows={[
              { label: '患者名', value: `${document.patientName} 様` },
              { label: '対象期間', value: document.periodLabel },
              { label: 'セット方式', value: document.setMethodLabel },
              { label: '配薬方法', value: document.packagingLabel },
              { label: '監査', value: document.auditLabel },
            ]}
          />
          <table className="mt-4 w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-400 text-left text-muted-foreground">
                <th className="py-1.5 pr-2 font-medium">薬剤名</th>
                <th className="py-1.5 pr-2 font-medium">用法</th>
                <th className="py-1.5 pr-2 font-medium">スロット</th>
                <th className="py-1.5 font-medium">数量</th>
              </tr>
            </thead>
            <tbody>
              {document.rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-muted-foreground">
                    処方明細データなし
                  </td>
                </tr>
              ) : (
                document.rows.map((row) => (
                  <tr key={row.lineNumber} className="border-b border-slate-200 align-top">
                    <td className="py-2 pr-2 font-medium text-foreground">{row.drugName}</td>
                    <td className="py-2 pr-2">{row.usageLabel}</td>
                    <td className="py-2 pr-2">{row.slotLabel}</td>
                    <td className="py-2">{row.quantityLabel}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {document.specialInstructions.length > 0 && (
            <p className="mt-3 text-xs text-foreground">
              特記事項: {document.specialInstructions.join(' / ')}
            </p>
          )}
          {document.notes && (
            <p className="mt-2 border-t border-slate-200 pt-2 text-xs text-foreground">
              備考: {document.notes}
            </p>
          )}
        </>
      )}
    </div>
  );
}

const CALENDAR_COLUMNS = [
  { key: 'morning', label: '朝' },
  { key: 'noon', label: '昼' },
  { key: 'evening', label: '夕' },
  { key: 'bedtime', label: '眠前' },
] as const;

function MedicationCalendarSheet({
  document,
  settings,
  target,
}: {
  document: MedicationCalendarDocument | null;
  settings: PrintOutputSettings;
  target: PrintTargetSummary;
}) {
  return (
    <div>
      <SheetHeader title="服薬カレンダー" settings={settings} target={target} />
      {!document ? (
        <EmptySheetBody note="カレンダーに載せる処方明細が未登録です。" />
      ) : (
        <>
          <SheetMetaRows
            rows={[
              { label: '患者名', value: `${document.patientName} 様` },
              { label: '対象期間', value: document.periodLabel },
            ]}
          />
          <table className="mt-4 w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-400 text-left text-muted-foreground">
                <th className="py-1.5 pr-2 font-medium">薬剤名</th>
                {CALENDAR_COLUMNS.map((column) => (
                  <th key={column.key} className="w-10 py-1.5 text-center font-medium">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {document.rows.map((row) => (
                <tr key={row.drugName} className="border-b border-slate-200">
                  <td className="py-2 pr-2">
                    <span className="font-medium text-foreground">{row.drugName}</span>
                    <span className="ml-1 text-muted-foreground">{row.usageLabel}</span>
                  </td>
                  {CALENDAR_COLUMNS.map((column) => (
                    <td key={column.key} className="py-2 text-center">
                      {row.marks[column.key] ? '●' : '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {document.prnRows.length > 0 && (
            <div className="mt-3 text-xs">
              <p className="font-medium text-foreground">頓用薬</p>
              <ul className="mt-1 space-y-1">
                {document.prnRows.map((row) => (
                  <li key={row.drugName} className="border-b border-slate-200 pb-1">
                    {row.drugName}({row.conditionLabel})
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function VisitReportSheet({
  document,
  settings,
  target,
}: {
  document: VisitReportDocument | null;
  settings: PrintOutputSettings;
  target: PrintTargetSummary;
}) {
  return (
    <div>
      <SheetHeader title="訪問報告書" settings={settings} target={target} />
      {!document ? (
        <EmptySheetBody note="確定済みの訪問報告書がまだありません。" />
      ) : (
        <>
          <SheetMetaRows
            rows={[
              { label: '患者名', value: `${document.patientName} 様` },
              { label: '種別', value: document.reportTypeLabel },
              { label: '報告日', value: document.reportDateLabel },
              { label: '状態', value: document.statusLabel },
            ]}
          />
          <div className="mt-4 space-y-3 text-xs">
            {document.items.map((item) => (
              <div key={item.label} className="border-b border-slate-200 pb-2">
                <p className="font-medium text-muted-foreground">{item.label}</p>
                <p className="mt-0.5 leading-5 text-foreground">{item.value}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function DocumentReceiptSheet({
  rows,
  settings,
  target,
}: {
  rows: DocumentReceiptRow[];
  settings: PrintOutputSettings;
  target: PrintTargetSummary;
}) {
  return (
    <div>
      <SheetHeader title="文書交付控え" settings={settings} target={target} />
      {rows.length === 0 ? (
        <EmptySheetBody note="交付済み文書(送達記録)がまだありません。" />
      ) : (
        <table className="mt-4 w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-400 text-left text-muted-foreground">
              <th className="py-1.5 pr-2 font-medium">文書</th>
              <th className="py-1.5 pr-2 font-medium">交付先</th>
              <th className="py-1.5 pr-2 font-medium">方法</th>
              <th className="py-1.5 pr-2 font-medium">交付日</th>
              <th className="py-1.5 font-medium">状態</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.deliveryId} className="border-b border-slate-200 align-top">
                <td className="py-2 pr-2">
                  <span className="font-medium text-foreground">{row.documentLabel}</span>
                  <span className="block text-muted-foreground">{row.patientName} 様</span>
                </td>
                <td className="py-2 pr-2">{row.recipientName}</td>
                <td className="py-2 pr-2">{row.channelLabel}</td>
                <td className="py-2 pr-2">{row.sentAtLabel}</td>
                <td className="py-2">{row.statusLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function MedicationLabelSheet({
  cards,
  settings,
  target,
}: {
  cards: MedicationLabelCard[];
  settings: PrintOutputSettings;
  target: PrintTargetSummary;
}) {
  return (
    <div>
      <SheetHeader title="薬袋ラベル" settings={settings} target={target} />
      {cards.length === 0 ? (
        <EmptySheetBody note="ラベルにする処方明細が未登録です。" />
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {cards.map((card) => (
            <div
              key={card.lineId}
              className="rounded border border-slate-300 p-2 text-[12px] leading-4"
            >
              <p className="font-bold text-foreground">{card.patientName} 様</p>
              <p className="mt-1 font-medium text-foreground">{card.drugName}</p>
              <p className="mt-0.5 text-muted-foreground">
                {card.usageLabel} / {card.slotLabel}
              </p>
              <p className="text-muted-foreground">{card.quantityLabel}</p>
              {card.note && <p className="mt-0.5 text-[12px] text-state-blocked">{card.note}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FirstVisitDocumentsSheet({
  summary,
  settings,
  target,
}: {
  summary: FirstVisitDocumentPrintSummary;
  settings: PrintOutputSettings;
  target: PrintTargetSummary;
}) {
  return (
    <div>
      <SheetHeader title="契約・同意控え" settings={settings} target={target} />
      <SheetMetaRows
        rows={[
          { label: '患者名', value: `${summary.patientName} 様` },
          { label: '文書数', value: `${summary.rows.length}件` },
        ]}
      />
      {summary.rows.length === 0 ? (
        <EmptySheetBody note="初回訪問文書・契約同意書の履歴がまだありません。" />
      ) : (
        <>
          <table className="mt-4 w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-400 text-left text-muted-foreground">
                <th className="py-1.5 pr-2 font-medium">作成日</th>
                <th className="py-1.5 pr-2 font-medium">交付</th>
                <th className="py-1.5 pr-2 font-medium">最新履歴</th>
                <th className="py-1.5 pr-2 font-medium">印刷</th>
                <th className="py-1.5 font-medium">控え</th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((row) => (
                <tr key={row.documentId} className="border-b border-slate-200 align-top">
                  <td className="py-2 pr-2">{row.createdAtLabel}</td>
                  <td className="py-2 pr-2">
                    <span className="block text-foreground">{row.deliveredToLabel}</span>
                    <span className="block text-muted-foreground">{row.deliveredAtLabel}</span>
                  </td>
                  <td className="py-2 pr-2">
                    <span className="block text-foreground">{row.latestActionLabel}</span>
                    <span className="block text-muted-foreground">{row.latestStorageLabel}</span>
                    <span className="block text-muted-foreground">{row.latestTemplateLabel}</span>
                  </td>
                  <td className="py-2 pr-2">
                    <span className="block text-foreground">{row.latestPrintedAtLabel}</span>
                  </td>
                  <td className="py-2">{row.documentUrlLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {summary.contacts.length > 0 && (
            <div className="mt-4 text-xs">
              <p className="font-medium text-foreground">緊急連絡先控え</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {summary.contacts.map((contact) => (
                  <div key={contact.contactId} className="border border-slate-200 p-2 leading-4">
                    <p className="font-medium text-foreground">{contact.name}</p>
                    <p className="text-muted-foreground">
                      {contact.relationLabel} / {contact.priorityLabel}
                    </p>
                    <p className="text-muted-foreground">{contact.organizationLabel}</p>
                    <p className="text-muted-foreground">{contact.contactLabel}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FirstVisitPrintReadinessPanel({ summary }: { summary: FirstVisitPrintReadinessSummary }) {
  const badgeVariant = summary.status === 'blocked' ? 'destructive' : 'outline';
  const badgeClassName =
    summary.status === 'ready'
      ? 'border-state-done/30 bg-state-done/10 text-foreground'
      : summary.status === 'warning'
        ? 'border-state-confirm/30 bg-state-confirm/10 text-foreground'
        : undefined;
  const detailLabels =
    summary.status === 'blocked' ? summary.missingRequiredLabels : summary.warningLabels;

  return (
    <div
      data-testid="first-visit-print-readiness"
      className={cn(
        'rounded-lg border p-3 text-xs leading-5',
        summary.status === 'blocked'
          ? 'border-state-blocked/30 bg-state-blocked/5'
          : summary.status === 'warning'
            ? 'border-state-confirm/30 bg-state-confirm/10'
            : 'border-state-done/30 bg-state-done/10',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-foreground">印刷前チェック</p>
        <Badge variant={badgeVariant} className={badgeClassName}>
          {summary.label}
        </Badge>
      </div>
      <p
        className={cn(
          'mt-2',
          summary.status === 'blocked'
            ? 'text-state-blocked'
            : summary.status === 'warning'
              ? 'text-state-confirm'
              : 'text-state-done',
        )}
      >
        {summary.message}
      </p>
      {detailLabels.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground">
          {detailLabels.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
      ) : null}
      {summary.templateLabels.length > 0 ? (
        <p className="mt-2 text-muted-foreground">
          使用予定テンプレート: {summary.templateLabels.join(' / ')}
        </p>
      ) : null}
    </div>
  );
}

// ─── 画面本体 ────────────────────────────────────────────────────────────────

export function PrintHubContent() {
  const orgId = useOrgId();
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const targetSelection = resolvePrintTargetSelection(searchParams);
  const target = targetSelection.status === 'valid' ? targetSelection : null;
  const documentType =
    targetSelection.documentType ?? parsePrintDocumentType(searchParams.get('type'));
  const explicitPatientId = target?.patientId ?? null;
  const [visitReportAuditRunId] = useState(
    () => `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const [settings, setSettings] = useState<PrintOutputSettings>(DEFAULT_PRINT_OUTPUT_SETTINGS);
  const [printError, setPrintError] = useState<string | null>(null);
  const [firstVisitPrintConfirmationKey, setFirstVisitPrintConfirmationKey] = useState<
    string | null
  >(null);
  const [printConfirmationKey, setPrintConfirmationKey] = useState<string | null>(null);
  const printRequestInFlightRef = useRef(false);
  const printTargetGenerationRef = useRef(0);
  const [isPrintRequestPending, setIsPrintRequestPending] = useState(false);

  const {
    plan,
    intake,
    reports,
    firstVisitDocuments,
    firstVisitPatientName,
    firstVisitPrintReadiness,
    targetSummary,
    isLoading,
    isError,
    errorMessage,
  } = usePrintHubData(orgId, target);

  const setInstruction = buildSetInstructionDocument(plan, intake);
  const calendar = buildMedicationCalendarDocument(plan, intake);
  const receiptRows = buildDocumentReceiptRows(reports);
  const visitReportSource = reports[0] ?? null;
  const auditedVisitReportQuery = useQuery({
    queryKey: [
      'print-hub-care-report-print-audit',
      orgId,
      explicitPatientId,
      visitReportSource?.id,
      visitReportSource?.updated_at,
      visitReportAuditRunId,
    ],
    queryFn: async () => {
      if (!visitReportSource) throw new Error('印刷対象の報告書がありません');
      const res = await fetch(buildCareReportPrintAuditApiPath(visitReportSource.id), {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({ intent: 'preview_rendered' }),
      });
      return readApiJson<CareReportPrintAuditResponse>(res, {
        fallbackMessage: '報告書の印刷監査に失敗しました',
        schema: careReportPrintAuditResponseSchema,
      });
    },
    enabled: !!orgId && !!targetSummary && documentType === 'visit_report' && !!visitReportSource,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: 'always',
    staleTime: 0,
  });
  const auditedVisitReportPayload = auditedVisitReportQuery.data?.data;
  const canRenderAuditedVisitReport =
    auditedVisitReportPayload?.audited === true &&
    Boolean(visitReportSource) &&
    auditedVisitReportPayload.report?.id === visitReportSource?.id &&
    auditedVisitReportPayload.report?.updated_at === visitReportSource?.updated_at;
  const auditedPayload = auditedVisitReportPayload?.report;
  const auditedVisitReport: CareReportForPrint | null =
    visitReportSource && canRenderAuditedVisitReport && auditedPayload
      ? {
          ...visitReportSource,
          report_type: auditedPayload.report_type,
          updated_at: auditedPayload.updated_at,
          content: auditedPayload.content,
        }
      : null;
  const visitReport = buildVisitReportDocument(auditedVisitReport);
  const labelCards = buildMedicationLabelCards(plan, intake);
  const firstVisitDocumentSummary = buildFirstVisitDocumentPrintSummary(
    firstVisitPatientName,
    firstVisitDocuments,
  );
  const firstVisitDocumentIdsKey = firstVisitDocuments.map((document) => document.id).join('\0');
  const printSourceRevisionKey = JSON.stringify({
    targetSummary,
    plan,
    intake,
    report: visitReportSource,
    firstVisitDocuments,
    firstVisitPrintReadiness,
  });
  const currentPrintConfirmationKey = [
    documentType,
    explicitPatientId ?? '',
    target?.resourceId ?? '',
    printSourceRevisionKey,
    firstVisitDocumentIdsKey,
    settings.showFacilityName ? 'facility' : 'no-facility',
    settings.showQr ? 'qr' : 'no-qr',
    settings.saveCopy ? 'save-copy' : 'no-copy',
  ].join('\0');
  const currentPrintConfirmationKeyRef = useRef(currentPrintConfirmationKey);
  useLayoutEffect(() => {
    if (currentPrintConfirmationKeyRef.current === currentPrintConfirmationKey) return;
    currentPrintConfirmationKeyRef.current = currentPrintConfirmationKey;
    printTargetGenerationRef.current += 1;
  }, [currentPrintConfirmationKey]);
  const firstVisitPrintReadinessSummary =
    summarizeFirstVisitPrintReadiness(firstVisitPrintReadiness);
  const firstVisitPrintBlockMessage = firstVisitPrintBlockReason({
    readiness: firstVisitPrintReadinessSummary,
    documentCount: firstVisitDocuments.length,
  });
  const firstVisitPrintHistoryMutation = useMutation({
    mutationFn: () =>
      recordFirstVisitPrintHistory({
        orgId,
        patientId: explicitPatientId,
        documents: firstVisitDocuments,
        saveCopy: settings.saveCopy,
      }),
    onSuccess: async () => {
      if (explicitPatientId) {
        await queryClient.invalidateQueries({
          queryKey: ['print-hub-patient-documents', orgId, explicitPatientId, target?.resourceId],
        });
      }
    },
  });

  const selectDocumentType = (key: PrintDocumentTypeKey) => {
    printTargetGenerationRef.current += 1;
    const params = new URLSearchParams(searchParams.toString());
    params.set('type', key);
    params.delete('set_plan_id');
    params.delete('report_id');
    params.delete('document_id');
    setPrintConfirmationKey(null);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const toggleSetting = (key: keyof PrintOutputSettings) => (checked: boolean) => {
    printTargetGenerationRef.current += 1;
    setPrintConfirmationKey(null);
    setSettings((current) => ({ ...current, [key]: checked === true }));
  };

  const handlePrint = () => {
    setPrintError(null);
    if (printRequestInFlightRef.current) return;
    if (!target || !targetSummary) {
      setPrintError(
        targetSelection.status === 'invalid'
          ? targetSelection.message
          : '印刷対象の患者と文書を確認できません。対象画面から開き直してください。',
      );
      return;
    }
    if (documentType === 'first_visit_documents' && firstVisitPrintBlockMessage) {
      setPrintError(firstVisitPrintBlockMessage);
      return;
    }
    if (documentType === 'visit_report' && visitReportSource && !auditedVisitReport) {
      setPrintError('報告書の印刷監査が完了していません。再読み込みしてください。');
      return;
    }
    setPrintConfirmationKey(currentPrintConfirmationKey);
  };

  const handleConfirmedPrint = async () => {
    if (printRequestInFlightRef.current) return;
    setPrintError(null);
    if (!target || !targetSummary || printConfirmationKey !== currentPrintConfirmationKey) {
      setPrintError('印刷対象が変わりました。対象を確認してもう一度操作してください。');
      return;
    }
    const requestedConfirmationKey = currentPrintConfirmationKey;
    const requestedTargetGeneration = printTargetGenerationRef.current;
    printRequestInFlightRef.current = true;
    setIsPrintRequestPending(true);
    try {
      if (documentType === 'visit_report' && visitReportSource) {
        const printableVisitReport = auditedVisitReport;
        if (!printableVisitReport) {
          setPrintError('報告書の印刷監査が完了していません。再読み込みしてください。');
          return;
        }
        const res = await fetch(buildCareReportPrintAuditApiPath(visitReportSource.id), {
          method: 'POST',
          headers: buildOrgJsonHeaders(orgId),
          body: JSON.stringify({
            intent: 'print_requested',
            expected_report_updated_at: printableVisitReport.updated_at,
          }),
        });
        try {
          const audit = await readApiJson<CareReportPrintAuditResponse>(res, {
            fallbackMessage: '報告書の印刷監査を記録できませんでした。再読み込みしてください。',
            schema: careReportPrintAuditResponseSchema,
          });
          if (
            audit.data.audited !== true ||
            !audit.data.report ||
            audit.data.report.id !== visitReportSource.id ||
            audit.data.report.updated_at !== printableVisitReport.updated_at
          ) {
            setPrintError('報告書の印刷監査を記録できませんでした。再読み込みしてください。');
            return;
          }
        } catch {
          setPrintError('報告書の印刷監査を記録できませんでした。再読み込みしてください。');
          return;
        }
      }
      if (
        currentPrintConfirmationKeyRef.current !== requestedConfirmationKey ||
        printTargetGenerationRef.current !== requestedTargetGeneration
      ) {
        setPrintError('印刷対象が変わりました。対象を確認してもう一度操作してください。');
        return;
      }
      window.print();
      if (documentType === 'first_visit_documents' && firstVisitDocuments.length > 0) {
        setFirstVisitPrintConfirmationKey(currentPrintConfirmationKey);
      }
    } finally {
      printRequestInFlightRef.current = false;
      setIsPrintRequestPending(false);
    }
  };

  const handleConfirmFirstVisitPrint = async () => {
    setPrintError(null);
    try {
      await firstVisitPrintHistoryMutation.mutateAsync();
      setFirstVisitPrintConfirmationKey(null);
    } catch (error) {
      if (error instanceof FirstVisitPrintVersionConflictError) {
        setFirstVisitPrintConfirmationKey(null);
        if (explicitPatientId) {
          await queryClient.invalidateQueries({
            queryKey: ['print-hub-patient-documents', orgId, explicitPatientId, target?.resourceId],
          });
        }
        setPrintError(
          '印刷後に文書の更新が検出されました。今印刷した帳票は使用せず破棄し、最新データを再読み込みして再印刷してください。',
        );
        return;
      }
      setPrintError(messageFromError(error, '初回文書の印刷履歴を記録できませんでした'));
    }
  };

  const renderSheetBody = () => {
    if (targetSelection.status === 'invalid') {
      return (
        <div className="flex h-full items-center justify-center p-6 text-center text-xs leading-6 text-muted-foreground">
          {targetSelection.message}
        </div>
      );
    }
    if (outputIsLoading) {
      return (
        <LoadingSheetBody
          title={printDocumentTypeLabel(documentType)}
          settings={settings}
          target={targetSummary}
        />
      );
    }
    if (outputIsError || !targetSummary) {
      return (
        <div className="flex h-full items-center justify-center p-6 text-center text-xs text-destructive">
          {errorMessage}
        </div>
      );
    }
    switch (documentType) {
      case 'set_instruction':
        return (
          <SetInstructionSheet
            document={setInstruction}
            settings={settings}
            target={targetSummary}
          />
        );
      case 'medication_calendar':
        return (
          <MedicationCalendarSheet document={calendar} settings={settings} target={targetSummary} />
        );
      case 'visit_report':
        return (
          <VisitReportSheet document={visitReport} settings={settings} target={targetSummary} />
        );
      case 'document_receipt':
        return (
          <DocumentReceiptSheet rows={receiptRows} settings={settings} target={targetSummary} />
        );
      case 'medication_label':
        return (
          <MedicationLabelSheet cards={labelCards} settings={settings} target={targetSummary} />
        );
      case 'first_visit_documents':
        return (
          <FirstVisitDocumentsSheet
            summary={firstVisitDocumentSummary}
            settings={settings}
            target={targetSummary}
          />
        );
    }
  };

  const outputOptions: Array<{
    key: keyof PrintOutputSettings;
    id: string;
    label: string;
  }> = (() => {
    const options: Array<{
      key: keyof PrintOutputSettings;
      id: string;
      label: string;
    }> = [
      { key: 'showFacilityName', id: 'print-option-facility-name', label: '施設名を表示' },
      { key: 'showQr', id: 'print-option-qr', label: 'QRコードを付ける' },
    ];
    if (documentType === 'first_visit_documents') {
      options.push({ key: 'saveCopy', id: 'print-option-save-copy', label: '控えを保存' });
    }
    return options;
  })();
  const isFirstVisitPrint = documentType === 'first_visit_documents';
  const shouldConfirmFirstVisitPrint = isFirstVisitPrint && firstVisitDocuments.length > 0;
  const awaitingFirstVisitPrintConfirmation =
    firstVisitPrintConfirmationKey === currentPrintConfirmationKey;
  const outputIsLoading =
    isLoading ||
    (documentType === 'visit_report' &&
      Boolean(targetSummary) &&
      Boolean(visitReportSource) &&
      !canRenderAuditedVisitReport &&
      (auditedVisitReportQuery.isPending || auditedVisitReportQuery.isFetching));
  const outputIsError =
    isError ||
    (documentType === 'visit_report' &&
      Boolean(targetSummary) &&
      Boolean(visitReportSource) &&
      (auditedVisitReportQuery.isError ||
        (auditedVisitReportQuery.isSuccess && !canRenderAuditedVisitReport)));
  const targetDisabledReason =
    targetSelection.status === 'invalid'
      ? targetSelection.message
      : isLoading
        ? '印刷対象の患者と文書を確認しています。'
        : isError || !targetSummary
          ? errorMessage
          : null;
  const printDisabledReason =
    targetDisabledReason ??
    (documentType === 'visit_report' &&
    targetSummary &&
    visitReportSource &&
    !canRenderAuditedVisitReport &&
    (auditedVisitReportQuery.isPending || auditedVisitReportQuery.isFetching)
      ? '報告書の印刷監査を確認しています。'
      : documentType === 'visit_report' &&
          visitReportSource &&
          !canRenderAuditedVisitReport &&
          (auditedVisitReportQuery.isError || auditedVisitReportQuery.isSuccess)
        ? '報告書の印刷監査が完了していません。再読み込みしてください。'
        : isFirstVisitPrint
          ? firstVisitPrintBlockMessage
          : null);
  const printDisabled =
    isPrintRequestPending ||
    firstVisitPrintHistoryMutation.isPending ||
    Boolean(printDisabledReason);
  const printDialogOpen =
    Boolean(targetSummary) && printConfirmationKey === currentPrintConfirmationKey;

  return (
    <>
      <div
        data-testid="print-hub-root"
        className="grid grid-cols-1 items-stretch gap-3 xl:grid-cols-[300px_minmax(0,1fr)_280px] xl:min-h-[calc(100dvh-6rem)]"
      >
        {/* ── 左カラム: 印刷するもの ── */}
        <section
          aria-labelledby="print-targets-heading"
          data-testid="print-target-list"
          className="rounded-xl border border-border/70 bg-card p-4 shadow-sm print:hidden sm:p-5"
        >
          <h2 id="print-targets-heading" className="text-base font-bold text-foreground">
            印刷するもの
          </h2>
          <div className="mt-5 space-y-5">
            {PRINT_DOCUMENT_TYPES.map((type) => {
              const selected = type.key === documentType;
              return (
                <button
                  key={type.key}
                  type="button"
                  aria-pressed={selected}
                  data-testid={`print-target-${type.key}`}
                  onClick={() => selectDocumentType(type.key)}
                  className={cn(
                    'min-h-11 w-full rounded-lg border px-4 py-3.5 text-left text-sm font-medium transition-colors',
                    'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                    selected
                      ? 'border-primary/40 bg-primary/10 text-foreground'
                      : 'border-border/70 bg-card text-foreground hover:bg-muted/40',
                  )}
                >
                  {type.label}
                </button>
              );
            })}
          </div>
        </section>

        {/* ── 中央カラム: プレビュー ── */}
        <section
          aria-labelledby="print-preview-heading"
          className="rounded-xl border border-border/70 bg-card p-4 shadow-sm print:rounded-none print:border-0 print:bg-transparent print:p-0 print:shadow-none sm:p-5"
        >
          <h2
            id="print-preview-heading"
            className="text-base font-bold text-foreground print:hidden"
          >
            プレビュー
          </h2>
          {/* A4 縦(210:297)の白紙カード。印刷時は比率固定を解除して全文を流し込む */}
          <div
            data-testid="print-preview-sheet"
            aria-label={`${printDocumentTypeLabel(documentType)} のプレビュー`}
            className={cn(
              'mx-auto mt-4 aspect-[210/297] w-full max-w-[480px] overflow-hidden rounded-lg border border-border/80 bg-white p-7 shadow-sm',
              'print:mt-0 print:aspect-auto print:max-w-none print:overflow-visible print:rounded-none print:border-0 print:p-0 print:shadow-none',
            )}
          >
            {renderSheetBody()}
          </div>
        </section>

        {/* ── 右カラム: 出力設定 ── */}
        <section
          aria-labelledby="print-settings-heading"
          data-testid="print-output-settings"
          className="flex flex-col rounded-xl border border-border/70 bg-card p-4 shadow-sm print:hidden sm:p-5"
        >
          <h2 id="print-settings-heading" className="text-base font-bold text-foreground">
            出力設定
          </h2>
          <div className="mt-5 space-y-5">
            {outputOptions.map((option) => (
              <div key={option.key} className="flex min-h-11 items-center gap-2.5">
                <Checkbox
                  id={option.id}
                  checked={settings[option.key]}
                  onCheckedChange={toggleSetting(option.key)}
                />
                <Label
                  htmlFor={option.id}
                  className="flex h-11 flex-1 items-center text-sm font-normal text-foreground"
                >
                  {option.label}
                </Label>
              </div>
            ))}
            {isFirstVisitPrint && !isLoading && !isError ? (
              <FirstVisitPrintReadinessPanel summary={firstVisitPrintReadinessSummary} />
            ) : null}
          </div>
          <div className="mt-14">
            <Button
              type="button"
              className="!min-h-11 w-full"
              data-testid="print-submit-button"
              onClick={() => void handlePrint()}
              aria-describedby={printDisabledReason ? PRINT_DISABLED_REASON_ID : undefined}
              disabled={printDisabled}
            >
              {awaitingFirstVisitPrintConfirmation ? 'もう一度印刷する' : '印刷する'}
            </Button>
            {printDisabledReason ? (
              <p
                id={PRINT_DISABLED_REASON_ID}
                className="mt-2 text-xs leading-5 text-muted-foreground"
              >
                {printDisabledReason}
              </p>
            ) : null}
            {shouldConfirmFirstVisitPrint && awaitingFirstVisitPrintConfirmation ? (
              <div className="mt-3 space-y-3 rounded-lg border-l-4 border-border/70 border-l-state-confirm bg-card px-3 py-3">
                <p className="text-xs leading-5 text-state-confirm">
                  紙またはPDFの出力が完了してから、印刷履歴を記録してください。
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  className="!min-h-11 w-full"
                  data-testid="first-visit-print-confirm-button"
                  onClick={() => void handleConfirmFirstVisitPrint()}
                  disabled={firstVisitPrintHistoryMutation.isPending}
                >
                  {firstVisitPrintHistoryMutation.isPending ? '履歴記録中...' : '印刷完了を記録'}
                </Button>
              </div>
            ) : null}
            {printError ? (
              <p className="mt-2 text-xs leading-5 text-destructive" role="alert">
                {printError}
              </p>
            ) : null}
            {isFirstVisitPrint && settings.saveCopy && (
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                印刷完了を記録すると、患者文書にこの印刷プレビューの控えリンクを保存します。紙控えが必要な場合は印刷ダイアログでPDF保存してください。
              </p>
            )}
          </div>
        </section>
      </div>
      <ConfirmDialog
        open={printDialogOpen}
        onOpenChange={(open) => {
          if (!open) setPrintConfirmationKey(null);
        }}
        title="印刷対象を確認"
        description="患者、生年月日、文書種別、出力元、状態を照合してから印刷してください。"
        confirmLabel="この対象を印刷"
        requiredConfirmText={targetSummary?.patientName}
        autoFocusConfirm
        confirmDisabled={printDisabled}
        onConfirm={() => void handleConfirmedPrint()}
      >
        {targetSummary ? <PrintTargetDetails target={targetSummary} /> : null}
      </ConfirmDialog>
    </>
  );
}
