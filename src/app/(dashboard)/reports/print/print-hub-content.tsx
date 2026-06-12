'use client';

import { useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Loading } from '@/components/ui/loading';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { cn } from '@/lib/utils';
import {
  buildDocumentReceiptRows,
  buildMedicationCalendarDocument,
  buildMedicationLabelCards,
  buildSetInstructionDocument,
  buildVisitReportDocument,
  DEFAULT_PRINT_OUTPUT_SETTINGS,
  parsePrintDocumentType,
  pickIntakeForCycle,
  pickPrintSetPlan,
  pickVisitReportForPrint,
  PRINT_DOCUMENT_TYPES,
  printDocumentTypeLabel,
  type CareReportForPrint,
  type DocumentReceiptRow,
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
 * 左「印刷するもの」(5 帳票カード)/ 中央「プレビュー」(A4 縦の白紙カード)/
 * 右「出力設定」(チェック 4 つ + 印刷する)の 3 カラム。
 * 印刷時はプレビューの帳票のみを出力する(他カラムとカード枠は print:hidden)。
 */

// ─── データ取得 ──────────────────────────────────────────────────────────────

type SetPlansResponse = { data: SetPlanForPrint[] };
type PatientPrescriptionsResponse = {
  patient: { id: string; name: string; name_kana: string };
  data: PrescriptionIntakeForPrint[];
};
type CareReportsResponse = { data: CareReportForPrint[] };

function usePrintHubData(orgId: string) {
  const setPlansQuery = useQuery({
    queryKey: ['print-hub-set-plans', orgId],
    queryFn: async () => {
      const res = await fetch('/api/set-plans', { headers: { 'x-org-id': orgId } });
      if (!res.ok) throw new Error('セットプランの取得に失敗しました');
      return res.json() as Promise<SetPlansResponse>;
    },
    enabled: !!orgId,
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
        headers: { 'x-org-id': orgId },
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
      const res = await fetch('/api/care-reports?limit=50', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('報告書の取得に失敗しました');
      return res.json() as Promise<CareReportsResponse>;
    },
    enabled: !!orgId,
    staleTime: 60_000,
  });

  const intake = useMemo(
    () => pickIntakeForCycle(prescriptionsQuery.data?.data ?? [], plan?.cycle_id),
    [prescriptionsQuery.data, plan],
  );
  const reports = useMemo(() => careReportsQuery.data?.data ?? [], [careReportsQuery.data]);

  return {
    plan,
    intake,
    reports,
    // disabled クエリは isLoading=false になるため isPending で判定する。
    // 処方明細はプラン確定後にだけ待つ(プラン 0 件で待ち続けない)。
    isLoading:
      setPlansQuery.isPending ||
      careReportsQuery.isPending ||
      (!!patientId && prescriptionsQuery.isPending),
    isError: setPlansQuery.isError || careReportsQuery.isError || prescriptionsQuery.isError,
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
              { label: '患者名', value: settings.showPatientName ? `${document.patientName} 様` : null },
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
              { label: '患者名', value: settings.showPatientName ? `${document.patientName} 様` : null },
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
              { label: '患者名', value: settings.showPatientName ? `${document.patientName} 様` : null },
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

// ─── 画面本体 ────────────────────────────────────────────────────────────────

export function PrintHubContent() {
  const orgId = useOrgId();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const documentType = parsePrintDocumentType(searchParams.get('type'));
  const [settings, setSettings] = useState<PrintOutputSettings>(DEFAULT_PRINT_OUTPUT_SETTINGS);

  const { plan, intake, reports, isLoading, isError } = usePrintHubData(orgId);

  const setInstruction = useMemo(() => buildSetInstructionDocument(plan, intake), [plan, intake]);
  const calendar = useMemo(() => buildMedicationCalendarDocument(plan, intake), [plan, intake]);
  const visitReport = useMemo(
    () => buildVisitReportDocument(pickVisitReportForPrint(reports)),
    [reports],
  );
  const receiptRows = useMemo(() => buildDocumentReceiptRows(reports), [reports]);
  const labelCards = useMemo(() => buildMedicationLabelCards(plan, intake), [plan, intake]);

  const selectDocumentType = (key: PrintDocumentTypeKey) => {
    router.replace(`${pathname}?type=${key}`, { scroll: false });
  };

  const toggleSetting = (key: keyof PrintOutputSettings) => (checked: boolean) => {
    setSettings((current) => ({ ...current, [key]: checked === true }));
  };

  const renderSheetBody = () => {
    if (isLoading) {
      return (
        <div className="flex h-full items-center justify-center">
          <Loading label="帳票データを読み込み中..." />
        </div>
      );
    }
    if (isError) {
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
    }
  };

  const outputOptions: Array<{
    key: keyof PrintOutputSettings;
    id: string;
    label: string;
  }> = [
    { key: 'showPatientName', id: 'print-option-patient-name', label: '患者名を表示' },
    { key: 'showFacilityName', id: 'print-option-facility-name', label: '施設名を表示' },
    { key: 'showQr', id: 'print-option-qr', label: 'QRコードを付ける' },
    { key: 'saveCopy', id: 'print-option-save-copy', label: '控えを保存' },
  ];

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
        </div>
        <div className="mt-14">
          <Button
            type="button"
            className="min-h-11 w-full"
            data-testid="print-submit-button"
            onClick={() => window.print()}
          >
            印刷する
          </Button>
          {settings.saveCopy && (
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              控えを残す場合は、印刷ダイアログで「PDFとして保存」を選んでください。
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
