'use client';

import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { CheckCircle2, Clock, ExternalLink, MessageSquare, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumnMeta } from '@/components/ui/data-table';
import { PatientHistoryQuickLinks } from '@/components/features/patients/patient-history-quick-links';
import { PatientHistorySummary } from '@/components/features/patients/patient-history-summary';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { formatDisplayEntityLabel } from '@/lib/display-id/display-labels';
import { buildPrescriptionIntakeApiPath } from '@/lib/prescriptions/api-paths';
import { buildPrescriptionHref } from '@/lib/prescriptions/navigation';
import { buildPatientHref } from '@/lib/patient/navigation';
import { cn } from '@/lib/utils';
import { STATUS_TOKENS, type StatusRole } from '@/lib/constants/status-tokens';
import { SOURCE_LABELS } from './new/prescription-form.shared';
import {
  CYCLE_STATUS_CONFIG,
  type InquiryRecord,
  type PrescriptionLine,
} from './prescription.shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type IntakeDetail = {
  id: string;
  display_id: string | null;
  cycle_id: string;
  source_type: string;
  prescribed_date: string;
  prescriber_name: string | null;
  prescriber_institution: string | null;
  prescriber_institution_id: string | null;
  prescriber_institution_ref: {
    id: string;
    name: string;
    institution_code: string | null;
    phone: string | null;
    fax: string | null;
  } | null;
  prescription_expiry_date: string | null;
  original_document_url: string | null;
  refill_remaining_count: number | null;
  refill_next_dispense_date: string | null;
  split_dispense_total: number | null;
  split_dispense_current: number | null;
  split_next_dispense_date: string | null;
  created_at: string;
  lines: PrescriptionLine[];
  cycle: {
    id: string;
    display_id: string | null;
    overall_status: string;
    patient_id: string;
    case_id: string;
    case_: {
      patient: {
        id: string;
        name: string;
        name_kana: string;
        birth_date: string | null;
        gender: string | null;
      };
    };
    inquiries: InquiryRecord[];
  };
};

const INQUIRY_RESULT_CONFIG: Record<string, { label: string; role: StatusRole }> = {
  changed: { label: '処方変更', role: 'info' },
  unchanged: { label: '変更なし', role: 'readonly' },
  pending: { label: '回答待ち', role: 'waiting' },
};

const GENDER_LABELS: Record<string, string> = {
  male: '男',
  female: '女',
  other: '他',
};

const prescriptionLineColumns: ColumnDef<PrescriptionLine>[] = [
  {
    accessorKey: 'line_number',
    header: '#',
    enableSorting: false,
    meta: { mobileLabel: '#' } satisfies DataTableColumnMeta<PrescriptionLine>,
    cell: ({ row }) => (
      <span className="tabular-nums text-muted-foreground">{row.original.line_number}</span>
    ),
  },
  {
    accessorKey: 'drug_name',
    header: '薬剤名',
    enableSorting: false,
    meta: { mobileLabel: '薬剤名' } satisfies DataTableColumnMeta<PrescriptionLine>,
    cell: ({ row }) => (
      <div>
        <div className="font-medium leading-tight">{row.original.drug_name}</div>
        {row.original.drug_code ? (
          <span className="text-[10px] text-muted-foreground">{row.original.drug_code}</span>
        ) : null}
        {row.original.dosage_form ? (
          <span className="ml-1 text-[10px] text-muted-foreground">{row.original.dosage_form}</span>
        ) : null}
        {row.original.packaging_instructions ? (
          <div className="text-[10px] text-state-confirm">
            包: {row.original.packaging_instructions}
          </div>
        ) : null}
      </div>
    ),
  },
  {
    accessorKey: 'dose',
    header: '用量',
    enableSorting: false,
    meta: { mobileLabel: '用量' } satisfies DataTableColumnMeta<PrescriptionLine>,
    cell: ({ row }) => <span className="text-muted-foreground">{row.original.dose}</span>,
  },
  {
    accessorKey: 'frequency',
    header: '用法',
    enableSorting: false,
    meta: { mobileLabel: '用法' } satisfies DataTableColumnMeta<PrescriptionLine>,
    cell: ({ row }) => <span className="text-muted-foreground">{row.original.frequency}</span>,
  },
  {
    accessorKey: 'days',
    header: '日数',
    enableSorting: false,
    meta: { mobileLabel: '日数' } satisfies DataTableColumnMeta<PrescriptionLine>,
    cell: ({ row }) => <span className="tabular-nums">{row.original.days}日</span>,
  },
  {
    id: 'classification',
    header: '区分',
    enableSorting: false,
    meta: { mobileLabel: '区分' } satisfies DataTableColumnMeta<PrescriptionLine>,
    cell: ({ row }) =>
      row.original.is_generic ? (
        <span className="rounded bg-tag-info/10 px-1 py-0.5 text-[9px] font-medium text-tag-info">
          後発
        </span>
      ) : row.original.is_generic_name_prescription ? (
        <span className="rounded bg-state-done/10 px-1 py-0.5 text-[9px] font-medium text-state-done">
          一般名
        </span>
      ) : (
        <span className="text-[10px] text-muted-foreground">先発</span>
      ),
  },
];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PrescriptionInlineDetail({ intakeId }: { intakeId: string }) {
  const orgId = useOrgId();

  const { data, isLoading, error } = useQuery({
    queryKey: ['prescription-intake-detail', orgId, intakeId],
    queryFn: async () => {
      const res = await fetch(buildPrescriptionIntakeApiPath(intakeId), {
        headers: buildOrgHeaders(orgId),
      });
      if (!res.ok) throw new Error('取得失敗');
      return res.json() as Promise<IntakeDetail>;
    },
    enabled: !!orgId && !!intakeId,
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        読込中...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-destructive">
        読み込みに失敗しました
      </div>
    );
  }

  const patient = data.cycle.case_.patient;
  const statusConfig = CYCLE_STATUS_CONFIG[data.cycle.overall_status] ?? {
    label: data.cycle.overall_status,
    variant: 'outline' as const,
  };
  const inquiries = data.cycle.inquiries;
  const prescriptionDetailHref = buildPrescriptionHref(data.id);
  const prescriptionDisplayLabel = formatDisplayEntityLabel(data);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── ヘッダ: 患者 + ステータス ── */}
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2">
        <Badge
          variant={statusConfig.variant}
          className={`text-[11px] ${statusConfig.className ?? ''}`}
        >
          {statusConfig.label}
        </Badge>
        <div className="flex items-baseline gap-1.5">
          <span className="text-sm font-semibold text-foreground">{patient.name}</span>
          <span className="text-[10px] text-muted-foreground">{patient.name_kana}</span>
          {patient.birth_date && (
            <span className="text-[10px] text-muted-foreground">
              {format(parseISO(patient.birth_date), 'yyyy/MM/dd')}
              {patient.gender ? ` ${GENDER_LABELS[patient.gender] ?? ''}` : ''}
            </span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="!h-auto !min-h-11 !min-w-11 px-2 text-[10px] sm:!h-auto sm:!min-h-11 sm:!min-w-11"
            asChild
          >
            <Link href={prescriptionDetailHref}>
              <ExternalLink className="mr-0.5 size-3" aria-hidden="true" />
              詳細
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="!h-auto !min-h-11 !min-w-11 px-2 text-[10px] sm:!h-auto sm:!min-h-11 sm:!min-w-11"
            asChild
          >
            <Link href={buildPatientHref(patient.id)}>患者</Link>
          </Button>
        </div>
      </div>

      {/* ── 処方メタ情報 ── */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-b px-3 py-2 text-[11px] text-muted-foreground">
        <span>{SOURCE_LABELS[data.source_type] ?? data.source_type}</span>
        <span>
          処方日: {format(parseISO(data.prescribed_date), 'yyyy/MM/dd (E)', { locale: ja })}
        </span>
        {data.prescriber_name && <span>処方医: {data.prescriber_name}</span>}
        {data.prescriber_institution && <span>機関: {data.prescriber_institution}</span>}
        {data.prescriber_institution_ref?.phone && (
          <span>TEL: {data.prescriber_institution_ref.phone}</span>
        )}
        {data.prescription_expiry_date && (
          <span>期限: {format(parseISO(data.prescription_expiry_date), 'MM/dd')}</span>
        )}
        {data.source_type === 'refill' && data.refill_remaining_count != null && (
          <span className="inline-flex items-center gap-0.5">
            <RefreshCw className="size-3" aria-hidden="true" />
            リフィル残{data.refill_remaining_count}回
          </span>
        )}
        {data.split_dispense_total && (
          <span>
            分割 {data.split_dispense_current}/{data.split_dispense_total}回
          </span>
        )}
        <span className="text-[10px]">ID: {prescriptionDisplayLabel}</span>
      </div>

      <PatientHistoryQuickLinks patientId={patient.id} patientName={patient.name} />
      <PatientHistorySummary patientId={patient.id} excludePrescriptionIntakeId={data.id} />

      {/* ── 処方明細テーブル (メイン領域) ── */}
      <div className="flex-1 overflow-y-auto">
        {data.lines.length > 0 ? (
          <DataTable
            columns={prescriptionLineColumns}
            data={data.lines}
            caption="処方明細"
            getRowId={(line) => line.id}
          />
        ) : (
          <div className="py-6 text-center text-xs text-muted-foreground">明細なし</div>
        )}
      </div>

      {/* ── 疑義照会 (ある場合のみ表示) ── */}
      {inquiries.length > 0 && (
        <div className="border-t">
          <div className="flex items-center gap-1.5 bg-state-confirm/10 px-3 py-1.5">
            <MessageSquare className="size-3 text-state-confirm" aria-hidden="true" />
            <span className="text-[11px] font-semibold text-state-confirm">
              疑義照会 {inquiries.length}件
            </span>
          </div>
          <div className="max-h-32 overflow-y-auto">
            {inquiries.map((inq) => {
              const resultCfg = inq.result ? INQUIRY_RESULT_CONFIG[inq.result] : null;
              return (
                <div key={inq.id} className="border-b border-border/30 px-3 py-1.5 text-[11px]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{inq.reason}</span>
                    {resultCfg && (
                      <span
                        className={cn(
                          'rounded px-1 py-0.5 text-[9px] font-medium',
                          STATUS_TOKENS[resultCfg.role].badgeClassName,
                        )}
                      >
                        {inq.resolved_at ? (
                          <CheckCircle2 className="mr-0.5 inline size-2.5" />
                        ) : (
                          <Clock className="mr-0.5 inline size-2.5" />
                        )}
                        {resultCfg.label}
                      </span>
                    )}
                    {inq.proposal_origin === 'pre_issuance' && (
                      <span className="rounded bg-tag-info/10 px-1 py-0.5 text-[9px] font-medium text-tag-info">
                        事前提案反映
                      </span>
                    )}
                    {inq.residual_adjustment && (
                      <span className="rounded bg-state-confirm/10 px-1 py-0.5 text-[9px] font-medium text-state-confirm">
                        残薬調整
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      → {inq.inquiry_to_physician}
                    </span>
                  </div>
                  <p className="mt-0.5 text-muted-foreground line-clamp-2">{inq.inquiry_content}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── フッタ: アクション ── */}
      <div className="flex items-center gap-2 border-t bg-muted/20 px-3 py-1.5">
        <Button
          variant="default"
          size="sm"
          className="!h-auto !min-h-11 px-3 text-[11px] sm:!h-auto sm:!min-h-11"
          asChild
        >
          <Link href="/dispense">調剤キューへ</Link>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="!h-auto !min-h-11 px-3 text-[11px] sm:!h-auto sm:!min-h-11"
          asChild
        >
          <Link href={prescriptionDetailHref}>全画面表示</Link>
        </Button>
      </div>
    </div>
  );
}
