'use client';

import { useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { readApiJson } from '@/lib/api/client-json';
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
  parsePrintDocumentType,
  pickIntakeForCycle,
  pickPrintSetPlan,
  pickVisitReportForPrint,
  PRINT_DOCUMENT_TYPES,
  printDocumentTypeLabel,
  summarizeFirstVisitPrintReadiness,
  type CareReportForPrint,
  type DocumentReceiptRow,
  type FirstVisitDocumentForPrint,
  type FirstVisitDocumentPrintSummary,
  type FirstVisitPrintReadinessForPrint,
  type FirstVisitPrintReadinessSummary,
  type MedicationCalendarDocument,
  type MedicationLabelCard,
  type PrescriptionIntakeForPrint,
  type PrintDocumentTypeKey,
  type PrintOutputSettings,
  type SetInstructionDocument,
  type SetPlanForPrint,
  type VisitReportDocument,
} from './print-hub.shared';

/**
 * p0_47(帳票・印刷プレビュー)/reports/print。
 * 左「印刷するもの」(帳票カード)/ 中央「プレビュー」(A4 縦の白紙カード)/
 * 右「出力設定」(チェック 4 つ + 印刷する)の 3 カラム。
 * 印刷時はプレビューの帳票のみを出力する(他カラムとカード枠は print:hidden)。
 */
const PRINT_DISABLED_REASON_ID = 'print-submit-disabled-reason';

// ─── データ取得 ──────────────────────────────────────────────────────────────

type SetPlansResponse = { data: SetPlanForPrint[] };
type PatientPrescriptionsResponse = {
  patient: { id: string; name: string; name_kana: string };
  data: PrescriptionIntakeForPrint[];
};
type CareReportsResponse = { data: CareReportForPrint[] };
type PatientDocumentsForPrintResponse = {
  patient: { id: string; name: string; name_kana: string };
  print_readiness: FirstVisitPrintReadinessForPrint;
  first_visit_documents: FirstVisitDocumentForPrint[];
};

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
    headers: {
      'Content-Type': 'application/json',
      'x-org-id': orgId,
    },
    body: JSON.stringify({
      patient_id: patientId,
      document_ids: documents.map((document) => document.id),
      save_copy: saveCopy,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? '初回文書の印刷履歴を記録できませんでした');
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

function usePrintHubData(
  orgId: string,
  documentType: PrintDocumentTypeKey,
  explicitPatientId: string | null,
) {
  const needsSetPlan = documentTypeNeedsSetPlan(documentType);
  const needsCareReports = documentTypeNeedsCareReports(documentType);
  const needsFirstVisitDocuments = documentType === 'first_visit_documents';

  const setPlansQuery = useQuery({
    queryKey: ['print-hub-set-plans', orgId],
    queryFn: async () => {
      const res = await fetch('/api/set-plans', { headers: { 'x-org-id': orgId } });
      if (!res.ok) throw new Error('セットプランの取得に失敗しました');
      return res.json() as Promise<SetPlansResponse>;
    },
    enabled: !!orgId && needsSetPlan,
    staleTime: 60_000,
  });

  const plan = useMemo(
    () => pickPrintSetPlan(setPlansQuery.data?.data ?? []),
    [setPlansQuery.data],
  );
  const patientId = plan?.cycle.patient_id ?? null;

  const prescriptionsQuery = useQuery({
    queryKey: ['print-hub-prescriptions', orgId, patientId],
    queryFn: async () => {
      const res = await fetch(`/api/patients/${patientId}/prescriptions?limit=20`, {
        headers: { 'content-type': 'application/json', 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('処方明細の取得に失敗しました');
      return res.json() as Promise<PatientPrescriptionsResponse>;
    },
    enabled: !!orgId && !!patientId,
    staleTime: 60_000,
  });

  const careReportsQuery = useQuery({
    queryKey: ['print-hub-care-reports', orgId],
    queryFn: async () => {
      const res = await fetch('/api/care-reports?limit=50&status=confirmed', {
        headers: { 'content-type': 'application/json', 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('報告書の取得に失敗しました');
      return res.json() as Promise<CareReportsResponse>;
    },
    enabled: !!orgId && needsCareReports,
    staleTime: 60_000,
  });

  const patientDocumentsQuery = useQuery({
    queryKey: ['print-hub-patient-documents', orgId, explicitPatientId],
    queryFn: async () => {
      const res = await fetch(`/api/patients/${explicitPatientId}/documents`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('患者文書の取得に失敗しました');
      return res.json() as Promise<PatientDocumentsForPrintResponse>;
    },
    enabled: !!orgId && !!explicitPatientId && needsFirstVisitDocuments,
    staleTime: 60_000,
  });

  const intake = useMemo(
    () => pickIntakeForCycle(prescriptionsQuery.data?.data ?? [], plan?.cycle_id),
    [prescriptionsQuery.data, plan],
  );
  const reports = useMemo(() => careReportsQuery.data?.data ?? [], [careReportsQuery.data]);
  const firstVisitDocuments = useMemo(
    () => patientDocumentsQuery.data?.first_visit_documents ?? [],
    [patientDocumentsQuery.data],
  );
  const firstVisitPatientName = patientDocumentsQuery.data?.patient.name ?? '患者名未設定';
  const firstVisitPrintReadiness = patientDocumentsQuery.data?.print_readiness ?? null;

  return {
    plan,
    intake,
    reports,
    firstVisitDocuments,
    firstVisitPatientName,
    firstVisitPrintReadiness,
    // disabled クエリは isLoading=false になるため isPending で判定する。
    // 選択中の帳票で不要な API 取得は待たない。既定のセット指示書で
    // care-reports 取得に引きずられてプレビューが空になるのを避ける。
    isLoading:
      (needsSetPlan && setPlansQuery.isPending) ||
      (needsCareReports && careReportsQuery.isPending) ||
      (needsFirstVisitDocuments && !!explicitPatientId && patientDocumentsQuery.isPending) ||
      (!!patientId && prescriptionsQuery.isPending),
    isError:
      (needsSetPlan && setPlansQuery.isError) ||
      (needsCareReports && careReportsQuery.isError) ||
      (needsFirstVisitDocuments && !explicitPatientId) ||
      (needsFirstVisitDocuments && patientDocumentsQuery.isError) ||
      prescriptionsQuery.isError,
  };
}

// ─── 帳票プレビュー(A4 内容)────────────────────────────────────────────────

/** A4 シート共通ヘッダ(発行元・出力日・QR プレースホルダ) */
function SheetHeader({ title, settings }: { title: string; settings: PrintOutputSettings }) {
  return (
    <header>
      <div className="flex items-start justify-between gap-2">
        {settings.showFacilityName ? (
          <p className="text-[10px] leading-5 text-muted-foreground">
            発行元: CareViaX薬局 / 出力日: {new Date().toLocaleDateString('ja-JP')}
          </p>
        ) : (
          <span aria-hidden="true" />
        )}
        {settings.showQr && (
          <div
            aria-label="QRコード(プレースホルダ)"
            data-testid="print-sheet-qr"
            className="flex size-10 shrink-0 items-center justify-center border border-dashed border-slate-400 text-[9px] text-slate-400"
          >
            QR
          </div>
        )}
      </div>
      <h3 className="mt-3 text-xl font-bold tracking-wide text-foreground">{title}</h3>
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

function LoadingSheetBody({ title, settings }: { title: string; settings: PrintOutputSettings }) {
  return (
    <div>
      <SheetHeader title={title} settings={settings} />
      <div className="mt-4 rounded border border-dashed border-slate-300 px-4 py-10 text-center text-xs leading-6 text-muted-foreground">
        帳票の明細を確認しています。完了するとこのプレビューに反映されます。
      </div>
    </div>
  );
}

function SetInstructionSheet({
  document,
  settings,
}: {
  document: SetInstructionDocument | null;
  settings: PrintOutputSettings;
}) {
  return (
    <div>
      <SheetHeader title="セット指示書" settings={settings} />
      {!document ? (
        <EmptySheetBody note="印刷対象のセットプランが未登録です。" />
      ) : (
        <>
          <SheetMetaRows
            rows={[
              {
                label: '患者名',
                value: settings.showPatientName ? `${document.patientName} 様` : null,
              },
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
}: {
  document: MedicationCalendarDocument | null;
  settings: PrintOutputSettings;
}) {
  return (
    <div>
      <SheetHeader title="服薬カレンダー" settings={settings} />
      {!document ? (
        <EmptySheetBody note="カレンダーに載せる処方明細が未登録です。" />
      ) : (
        <>
          <SheetMetaRows
            rows={[
              {
                label: '患者名',
                value: settings.showPatientName ? `${document.patientName} 様` : null,
              },
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
}: {
  document: VisitReportDocument | null;
  settings: PrintOutputSettings;
}) {
  return (
    <div>
      <SheetHeader title="訪問報告書" settings={settings} />
      {!document ? (
        <EmptySheetBody note="確定済みの訪問報告書がまだありません。" />
      ) : (
        <>
          <SheetMetaRows
            rows={[
              {
                label: '患者名',
                value: settings.showPatientName ? `${document.patientName} 様` : null,
              },
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
}: {
  rows: DocumentReceiptRow[];
  settings: PrintOutputSettings;
}) {
  return (
    <div>
      <SheetHeader title="文書交付控え" settings={settings} />
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
                  {settings.showPatientName && (
                    <span className="block text-muted-foreground">{row.patientName} 様</span>
                  )}
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
}: {
  cards: MedicationLabelCard[];
  settings: PrintOutputSettings;
}) {
  return (
    <div>
      <SheetHeader title="薬袋ラベル" settings={settings} />
      {cards.length === 0 ? (
        <EmptySheetBody note="ラベルにする処方明細が未登録です。" />
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {cards.map((card) => (
            <div
              key={card.lineId}
              className="rounded border border-slate-300 p-2 text-[11px] leading-4"
            >
              {settings.showPatientName && (
                <p className="font-bold text-foreground">{card.patientName} 様</p>
              )}
              <p className="mt-1 font-medium text-foreground">{card.drugName}</p>
              <p className="mt-0.5 text-muted-foreground">
                {card.usageLabel} / {card.slotLabel}
              </p>
              <p className="text-muted-foreground">{card.quantityLabel}</p>
              {card.note && <p className="mt-0.5 text-[10px] text-red-700">{card.note}</p>}
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
}: {
  summary: FirstVisitDocumentPrintSummary;
  settings: PrintOutputSettings;
}) {
  return (
    <div>
      <SheetHeader title="契約・同意控え" settings={settings} />
      <SheetMetaRows
        rows={[
          { label: '患者名', value: settings.showPatientName ? `${summary.patientName} 様` : null },
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
      ? 'border-transparent bg-state-done/10 text-state-done'
      : summary.status === 'warning'
        ? 'border-transparent bg-state-confirm/10 text-state-confirm'
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
  const documentType = parsePrintDocumentType(searchParams.get('type'));
  const explicitPatientId = searchParams.get('patient_id');
  const [settings, setSettings] = useState<PrintOutputSettings>(DEFAULT_PRINT_OUTPUT_SETTINGS);
  const [printError, setPrintError] = useState<string | null>(null);
  const [firstVisitPrintConfirmationKey, setFirstVisitPrintConfirmationKey] = useState<
    string | null
  >(null);

  const {
    plan,
    intake,
    reports,
    firstVisitDocuments,
    firstVisitPatientName,
    firstVisitPrintReadiness,
    isLoading,
    isError,
  } = usePrintHubData(orgId, documentType, explicitPatientId);

  const setInstruction = useMemo(() => buildSetInstructionDocument(plan, intake), [plan, intake]);
  const calendar = useMemo(() => buildMedicationCalendarDocument(plan, intake), [plan, intake]);
  const receiptRows = useMemo(() => buildDocumentReceiptRows(reports), [reports]);
  const visitReportSource = useMemo(() => pickVisitReportForPrint(reports), [reports]);
  const auditedVisitReportQuery = useQuery({
    queryKey: ['print-hub-care-report-print-audit', orgId, visitReportSource?.id],
    queryFn: async () => {
      if (!visitReportSource) throw new Error('印刷対象の報告書がありません');
      const res = await fetch(`/api/care-reports/${visitReportSource.id}/print-audit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({ intent: 'preview_rendered' }),
      });
      return readApiJson<CareReportPrintAuditResponse>(res, {
        fallbackMessage: '報告書の印刷監査に失敗しました',
        schema: careReportPrintAuditResponseSchema,
      });
    },
    enabled: !!orgId && documentType === 'visit_report' && !!visitReportSource,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 0,
  });
  const auditedVisitReport = useMemo<CareReportForPrint | null>(() => {
    const audited = auditedVisitReportQuery.data?.data.report;
    if (!visitReportSource || !audited) return null;
    return {
      ...visitReportSource,
      report_type: audited.report_type,
      content: audited.content,
    };
  }, [auditedVisitReportQuery.data, visitReportSource]);
  const visitReport = useMemo(
    () => buildVisitReportDocument(auditedVisitReport),
    [auditedVisitReport],
  );
  const labelCards = useMemo(() => buildMedicationLabelCards(plan, intake), [plan, intake]);
  const firstVisitDocumentSummary = useMemo(
    () => buildFirstVisitDocumentPrintSummary(firstVisitPatientName, firstVisitDocuments),
    [firstVisitPatientName, firstVisitDocuments],
  );
  const firstVisitDocumentIdsKey = useMemo(
    () => firstVisitDocuments.map((document) => document.id).join('\0'),
    [firstVisitDocuments],
  );
  const currentFirstVisitPrintConfirmationKey = useMemo(
    () =>
      [
        documentType,
        explicitPatientId ?? '',
        firstVisitDocumentIdsKey,
        settings.saveCopy ? 'save-copy' : 'no-copy',
      ].join('\0'),
    [documentType, explicitPatientId, firstVisitDocumentIdsKey, settings.saveCopy],
  );
  const firstVisitPrintReadinessSummary = useMemo(
    () => summarizeFirstVisitPrintReadiness(firstVisitPrintReadiness),
    [firstVisitPrintReadiness],
  );
  const firstVisitPrintBlockMessage = useMemo(
    () =>
      firstVisitPrintBlockReason({
        readiness: firstVisitPrintReadinessSummary,
        documentCount: firstVisitDocuments.length,
      }),
    [firstVisitDocuments.length, firstVisitPrintReadinessSummary],
  );
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
          queryKey: ['print-hub-patient-documents', orgId, explicitPatientId],
        });
      }
    },
  });

  const selectDocumentType = (key: PrintDocumentTypeKey) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('type', key);
    if (key !== 'first_visit_documents') {
      params.delete('patient_id');
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const toggleSetting = (key: keyof PrintOutputSettings) => (checked: boolean) => {
    setSettings((current) => ({ ...current, [key]: checked === true }));
  };

  const handlePrint = async () => {
    setPrintError(null);
    if (documentType === 'first_visit_documents' && firstVisitPrintBlockMessage) {
      setPrintError(firstVisitPrintBlockMessage);
      return;
    }
    if (documentType === 'first_visit_documents' && firstVisitDocuments.length > 0) {
      setFirstVisitPrintConfirmationKey(currentFirstVisitPrintConfirmationKey);
      window.print();
      return;
    }
    if (documentType === 'visit_report' && visitReportSource && !auditedVisitReport) {
      setPrintError('報告書の印刷監査が完了していません。再読み込みしてください。');
      return;
    }
    if (documentType === 'visit_report' && visitReportSource) {
      const res = await fetch(`/api/care-reports/${visitReportSource.id}/print-audit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({ intent: 'print_requested' }),
      });
      if (!res.ok) {
        setPrintError('報告書の印刷監査を記録できませんでした。再読み込みしてください。');
        return;
      }
    }
    window.print();
  };

  const handleConfirmFirstVisitPrint = async () => {
    setPrintError(null);
    try {
      await firstVisitPrintHistoryMutation.mutateAsync();
      setFirstVisitPrintConfirmationKey(null);
    } catch (error) {
      setPrintError(
        error instanceof Error ? error.message : '初回文書の印刷履歴を記録できませんでした',
      );
    }
  };

  const renderSheetBody = () => {
    if (outputIsLoading) {
      return <LoadingSheetBody title={printDocumentTypeLabel(documentType)} settings={settings} />;
    }
    if (outputIsError) {
      return (
        <div className="flex h-full items-center justify-center p-6 text-center text-xs text-destructive">
          帳票データの読み込みに失敗しました。再読み込みしてください。
        </div>
      );
    }
    switch (documentType) {
      case 'set_instruction':
        return <SetInstructionSheet document={setInstruction} settings={settings} />;
      case 'medication_calendar':
        return <MedicationCalendarSheet document={calendar} settings={settings} />;
      case 'visit_report':
        return <VisitReportSheet document={visitReport} settings={settings} />;
      case 'document_receipt':
        return <DocumentReceiptSheet rows={receiptRows} settings={settings} />;
      case 'medication_label':
        return <MedicationLabelSheet cards={labelCards} settings={settings} />;
      case 'first_visit_documents':
        return <FirstVisitDocumentsSheet summary={firstVisitDocumentSummary} settings={settings} />;
    }
  };

  const outputOptions: Array<{
    key: keyof PrintOutputSettings;
    id: string;
    label: string;
  }> = useMemo(() => {
    const options: Array<{
      key: keyof PrintOutputSettings;
      id: string;
      label: string;
    }> = [
      { key: 'showPatientName', id: 'print-option-patient-name', label: '患者名を表示' },
      { key: 'showFacilityName', id: 'print-option-facility-name', label: '施設名を表示' },
      { key: 'showQr', id: 'print-option-qr', label: 'QRコードを付ける' },
    ];
    if (documentType === 'first_visit_documents') {
      options.push({ key: 'saveCopy', id: 'print-option-save-copy', label: '控えを保存' });
    }
    return options;
  }, [documentType]);
  const isFirstVisitPrint = documentType === 'first_visit_documents';
  const shouldConfirmFirstVisitPrint = isFirstVisitPrint && firstVisitDocuments.length > 0;
  const awaitingFirstVisitPrintConfirmation =
    firstVisitPrintConfirmationKey === currentFirstVisitPrintConfirmationKey;
  const outputIsLoading =
    isLoading ||
    (documentType === 'visit_report' &&
      Boolean(visitReportSource) &&
      auditedVisitReportQuery.isPending);
  const outputIsError =
    isError ||
    (documentType === 'visit_report' &&
      Boolean(visitReportSource) &&
      auditedVisitReportQuery.isError);
  const printDisabledReason =
    documentType === 'visit_report' && visitReportSource && auditedVisitReportQuery.isPending
      ? '報告書の印刷監査を確認しています。'
      : documentType === 'visit_report' && visitReportSource && auditedVisitReportQuery.isError
        ? '報告書の印刷監査が完了していません。再読み込みしてください。'
        : isFirstVisitPrint
          ? firstVisitPrintBlockMessage
          : null;
  const printDisabled = firstVisitPrintHistoryMutation.isPending || Boolean(printDisabledReason);

  return (
    <div
      data-testid="print-hub-root"
      className="grid grid-cols-1 items-stretch gap-3 xl:grid-cols-[300px_minmax(0,1fr)_280px] xl:min-h-[calc(100vh-6rem)]"
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
        <h2 id="print-preview-heading" className="text-base font-bold text-foreground print:hidden">
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
            <div key={option.key} className="flex items-center gap-2.5">
              <Checkbox
                id={option.id}
                checked={settings[option.key]}
                onCheckedChange={toggleSetting(option.key)}
              />
              <Label htmlFor={option.id} className="text-sm font-normal text-foreground">
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
            className="min-h-11 w-full"
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
            <div className="mt-3 space-y-3 rounded-lg border border-state-confirm/30 bg-state-confirm/10 px-3 py-3">
              <p className="text-xs leading-5 text-state-confirm">
                紙またはPDFの出力が完了してから、印刷履歴を記録してください。
              </p>
              <Button
                type="button"
                variant="secondary"
                className="min-h-11 w-full"
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
  );
}
