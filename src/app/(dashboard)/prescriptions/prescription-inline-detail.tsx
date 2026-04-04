'use client';

import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  MessageSquare,
  Pill,
  RefreshCw,
} from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { SOURCE_LABELS } from './new/prescription-form.shared';
import { CYCLE_STATUS_CONFIG } from './prescription.shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PrescriptionLine = {
  id: string;
  line_number: number;
  drug_name: string;
  drug_code: string | null;
  dosage_form: string | null;
  dose: string;
  frequency: string;
  days: number;
  route: string | null;
  dispensing_method: string | null;
  is_generic: boolean;
  is_generic_name_prescription: boolean | null;
  packaging_instructions: string | null;
  notes: string | null;
};

type InquiryRecord = {
  id: string;
  reason: string;
  inquiry_to_physician: string;
  inquiry_content: string;
  result: string | null;
  change_detail: string | null;
  inquired_at: string;
  resolved_at: string | null;
};

type IntakeDetail = {
  id: string;
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

const INQUIRY_RESULT_CONFIG: Record<string, { label: string; className: string }> = {
  changed:   { label: '処方変更', className: 'bg-amber-100 text-amber-800' },
  unchanged: { label: '変更なし', className: 'bg-gray-100 text-gray-700' },
  pending:   { label: '回答待ち', className: 'bg-red-100 text-red-800' },
};

const GENDER_LABELS: Record<string, string> = {
  male: '男', female: '女', other: '他',
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PrescriptionInlineDetail({ intakeId }: { intakeId: string }) {
  const orgId = useOrgId();

  const { data, isLoading, error } = useQuery({
    queryKey: ['prescription-intake-detail', orgId, intakeId],
    queryFn: async () => {
      const res = await fetch(`/api/prescription-intakes/${intakeId}`, {
        headers: { 'x-org-id': orgId },
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
  const statusConfig = CYCLE_STATUS_CONFIG[data.cycle.overall_status] ?? { label: data.cycle.overall_status, variant: 'outline' as const };
  const inquiries = data.cycle.inquiries;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── ヘッダ: 患者 + ステータス ── */}
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2">
        <Badge variant={statusConfig.variant} className={`text-[11px] ${statusConfig.className ?? ''}`}>
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
          <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" asChild>
            <Link href={`/prescriptions/${data.id}`}>
              <ExternalLink className="mr-0.5 size-3" aria-hidden="true" />
              詳細
            </Link>
          </Button>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" asChild>
            <Link href={`/patients/${patient.id}`}>患者</Link>
          </Button>
        </div>
      </div>

      {/* ── 処方メタ情報 ── */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-b px-3 py-2 text-[11px] text-muted-foreground">
        <span>{SOURCE_LABELS[data.source_type] ?? data.source_type}</span>
        <span>処方日: {format(parseISO(data.prescribed_date), 'yyyy/MM/dd (E)', { locale: ja })}</span>
        {data.prescriber_name && <span>処方医: {data.prescriber_name}</span>}
        {data.prescriber_institution && <span>機関: {data.prescriber_institution}</span>}
        {data.prescriber_institution_ref?.phone && <span>TEL: {data.prescriber_institution_ref.phone}</span>}
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
          <span>分割 {data.split_dispense_current}/{data.split_dispense_total}回</span>
        )}
        <span className="text-[10px]">ID: {data.id.slice(-8)}</span>
      </div>

      {/* ── 処方明細テーブル (メイン領域) ── */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs" aria-label="処方明細">
          <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
            <tr className="border-b text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <th scope="col" className="w-8 px-2 py-1">#</th>
              <th scope="col" className="px-2 py-1">薬剤名</th>
              <th scope="col" className="px-2 py-1">用量</th>
              <th scope="col" className="px-2 py-1">用法</th>
              <th scope="col" className="w-14 px-2 py-1">日数</th>
              <th scope="col" className="w-12 px-2 py-1">区分</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((line, i) => (
              <tr
                key={line.id}
                className={`border-b border-border/30 ${i % 2 === 0 ? 'bg-background' : 'bg-muted/15'}`}
              >
                <td className="px-2 py-1 tabular-nums text-muted-foreground">{line.line_number}</td>
                <td className="px-2 py-1">
                  <div className="font-medium leading-tight">{line.drug_name}</div>
                  {line.drug_code && (
                    <span className="text-[10px] text-muted-foreground">{line.drug_code}</span>
                  )}
                  {line.dosage_form && (
                    <span className="ml-1 text-[10px] text-muted-foreground">{line.dosage_form}</span>
                  )}
                  {line.packaging_instructions && (
                    <div className="text-[10px] text-amber-700">包: {line.packaging_instructions}</div>
                  )}
                </td>
                <td className="px-2 py-1 text-muted-foreground">{line.dose}</td>
                <td className="px-2 py-1 text-muted-foreground">{line.frequency}</td>
                <td className="px-2 py-1 tabular-nums">{line.days}日</td>
                <td className="px-2 py-1">
                  {line.is_generic ? (
                    <span className="rounded bg-blue-50 px-1 py-0.5 text-[9px] font-medium text-blue-700">後発</span>
                  ) : line.is_generic_name_prescription ? (
                    <span className="rounded bg-green-50 px-1 py-0.5 text-[9px] font-medium text-green-700">一般名</span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">先発</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {data.lines.length === 0 && (
          <div className="py-6 text-center text-xs text-muted-foreground">明細なし</div>
        )}
      </div>

      {/* ── 疑義照会 (ある場合のみ表示) ── */}
      {inquiries.length > 0 && (
        <div className="border-t">
          <div className="flex items-center gap-1.5 bg-amber-50/50 px-3 py-1.5">
            <MessageSquare className="size-3 text-amber-700" aria-hidden="true" />
            <span className="text-[11px] font-semibold text-amber-800">
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
                      <span className={`rounded px-1 py-0.5 text-[9px] font-medium ${resultCfg.className}`}>
                        {inq.resolved_at ? <CheckCircle2 className="mr-0.5 inline size-2.5" /> : <Clock className="mr-0.5 inline size-2.5" />}
                        {resultCfg.label}
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
        <Button variant="default" size="sm" className="h-6 px-3 text-[11px]" asChild>
          <Link href="/dispensing">調剤キューへ</Link>
        </Button>
        <Button variant="outline" size="sm" className="h-6 px-3 text-[11px]" asChild>
          <Link href={`/prescriptions/${data.id}`}>
            全画面表示
          </Link>
        </Button>
      </div>
    </div>
  );
}
