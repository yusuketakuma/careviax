'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Controller, useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, History, Info, MessageSquarePlus } from 'lucide-react';
import { z } from 'zod';
import { formatDateKey } from '@/lib/date-key';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { PreviousStageSummary } from '@/components/features/workflow/previous-stage-summary';
import { StageTimeline } from '@/components/features/workflow/stage-timeline';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Loading } from '@/components/ui/loading';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { FormErrorSummary } from '@/components/ui/form-error-summary';
import { LoadingButton } from '@/components/ui/loading-button';
import { PageSection } from '@/components/layout/page-section';
import { ActionRail } from '@/components/ui/action-rail';
import { collectFormErrorSummaryItems } from '@/lib/forms/errors';
import { PresenceAvatars } from '@/components/features/collaboration/presence-avatars';
import { useCollaborativeForm } from '@/lib/hooks/use-collaborative-form';
import { CollaborativeTextarea } from '@/components/features/collaboration/collaborative-textarea';
import { CARRY_TYPE_OPTIONS } from '@/lib/dispensing/constants';
import { JahisSupplementalRecordsCard } from '@/components/features/prescriptions/jahis-supplemental-records-card';
import { CdsAlertPanel, type CdsAlert } from '@/components/features/cds/alert-panel';
import {
  normalizeJahisSupplementalRecords,
  type JahisSupplementalRecordDbView,
} from '@/lib/pharmacy/jahis-supplemental-records-view';
import { DISPENSE_SAFETY_CHECKLIST_ACK } from '@/lib/dispensing/safety-checklist';
import type {
  DispensePrefillLine,
  DispensePrefillResult,
  PackagingGroupAssignment,
} from '@/lib/dispensing/prefill-generator';

function toLineIdMap<T extends { line_id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((x) => [x.line_id, x]));
}

function InquiryBlockingAlert({
  message,
  reason,
  physicianNote,
  detail,
  proposalOrigin,
  residualAdjustment,
}: {
  message: string;
  reason?: string;
  physicianNote?: string | null;
  detail?: string | null;
  proposalOrigin?: 'post_inquiry' | 'pre_issuance' | null;
  residualAdjustment?: boolean | null;
}) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <p className="font-medium">{message}</p>
      {reason && (
        <p className="mt-1 text-xs">
          {reason}
          {physicianNote ? ` / ${physicianNote}` : ''}
        </p>
      )}
      {detail && <p className="mt-1 text-xs text-amber-800">{detail}</p>}
      {(proposalOrigin === 'pre_issuance' || residualAdjustment) && (
        <p className="mt-1 text-xs text-amber-800">
          {proposalOrigin === 'pre_issuance' ? '事前提案反映' : '照会後変更'}
          {residualAdjustment ? ' / 残薬調整' : ''}
        </p>
      )}
    </div>
  );
}

function OriginalCollectionCheckSection({
  check,
  onOpenPatientPrescriptions,
}: {
  check: DispenseTaskDetail['original_collection_check'];
  onOpenPatientPrescriptions: () => void;
}) {
  if (!check.required) return null;

  return (
    <PageSection
      title="処方せん原本の回収チェック"
      tone={check.collected ? 'subtle' : 'warning'}
      actions={
        <Badge variant={check.collected ? 'outline' : 'secondary'}>
          {check.collected ? '回収済み' : '要確認'}
        </Badge>
      }
      contentClassName="space-y-2 text-sm"
    >
      <div className="flex items-start gap-2">
        {check.collected ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
        ) : (
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
        )}
        <div className="space-y-2">
          <p className="text-muted-foreground">
            FAX受付のため、調剤は進められますが、訪問時回収または後日郵送到着後に原本回収の記録が必須です。
          </p>
          {check.collected ? (
            <p className="text-emerald-700">原本回収済み: {check.collected_at ?? '記録あり'}</p>
          ) : (
            <p className="text-amber-800">
              未回収です。患者詳細の処方履歴から原本回収を記録してください。
            </p>
          )}
        </div>
      </div>
      <ActionRail align="start">
        <Button type="button" variant="outline" size="sm" onClick={onOpenPatientPrescriptions}>
          原本回収を確認
        </Button>
      </ActionRail>
    </PageSection>
  );
}

type PrescriptionLine = {
  id: string;
  line_number: number;
  drug_name: string;
  drug_code: string | null;
  dosage_form: string | null;
  dose: string;
  frequency: string;
  days: number;
  quantity: number | null;
  unit: string | null;
  packaging_instructions: string | null;
  notes: string | null;
  start_date: string | null;
  end_date: string | null;
};

type DispenseTaskDetail = {
  id: string;
  priority: string;
  due_date: string | null;
  status: string;
  facility_label: string | null;
  prefill?: DispensePrefillResult;
  site: {
    id: string;
    name: string;
  } | null;
  stock_guidance: Array<{
    line_id: string;
    stock_status: 'stocked' | 'preferred_generic' | 'alternative_available' | 'out_of_stock';
    message: string;
    recommended_drug_name: string | null;
    recommended_drug_code: string | null;
    stocked_candidates: Array<{
      drug_master_id: string;
      drug_name: string;
      yj_code: string;
      source: 'exact' | 'preferred_generic' | 'alternative';
    }>;
  }>;
  results: Array<{
    id: string;
    line_id: string;
    actual_drug_name: string;
    actual_drug_code: string | null;
    actual_quantity: number;
    actual_unit: string | null;
    discrepancy_reason: string | null;
    carry_type: 'carry' | 'facility_deposit' | 'deferred';
    special_notes: string | null;
  }>;
  cycle: {
    id: string;
    patient_id: string;
    case_: {
      patient: {
        id: string;
        name: string;
        name_kana: string;
      };
    };
    prescription_intakes: Array<{
      id: string;
      source_type: string;
      prescribed_date: string;
      prescriber_name: string | null;
      prescriber_institution: string | null;
      original_collected_at: string | null;
      jahis_supplemental_records: JahisSupplementalRecordDbView[];
      lines: PrescriptionLine[];
    }>;
    inquiries: Array<{
      id: string;
      line_id: string | null;
      reason: string;
      inquiry_to_physician: string | null;
      inquiry_content: string;
      result: string | null;
      proposal_origin: 'post_inquiry' | 'pre_issuance' | null;
      residual_adjustment: boolean | null;
      change_detail: string | null;
      line: {
        id: string;
        line_number: number;
        drug_name: string;
      } | null;
    }>;
  };
  original_collection_check: {
    required: boolean;
    collected: boolean;
    collected_at: string | null;
  };
};

const lineResultSchema = z.object({
  line_id: z.string(),
  actual_drug_name: z.string().min(1, '実薬剤名は必須です'),
  actual_drug_code: z.string().optional(),
  actual_quantity: z.coerce
    .number({ error: '数量を入力してください' })
    .positive('正の数を入力してください'),
  actual_unit: z.string().optional(),
  discrepancy_reason: z.string().optional(),
  carry_type: z.enum(['carry', 'facility_deposit', 'deferred']),
  special_notes: z.string().optional(),
});

const formSchema = z.object({
  lines: z.array(lineResultSchema),
});

type FormInput = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

const priorityLabel: Record<string, string> = {
  emergency: '緊急',
  urgent: '至急',
  normal: '通常',
};

const priorityVariant: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  emergency: 'destructive',
  urgent: 'secondary',
  normal: 'outline',
};

const sourceTypeLabel: Record<string, string> = {
  paper: '紙処方箋',
  fax: 'FAX',
  e_prescription: '電子処方箋',
  facility_batch: '施設一括',
  refill: 'リフィル',
  qr_scan: 'QR取込',
};

const changeTypeLabel: Record<NonNullable<DispensePrefillLine['changeMarker']>, string> = {
  added: '新規追加',
  removed: '削除',
  dose_changed: '用量変更',
  frequency_changed: '用法変更',
  days_changed: '日数変更',
};

function formatMaybeDate(value: string | null | undefined) {
  if (!value) return '—';
  return value.slice(0, 10);
}

function DispensingInformationPanel({
  intake,
  previousIntake,
  prefill,
}: {
  intake: DispenseTaskDetail['cycle']['prescription_intakes'][number];
  previousIntake: DispenseTaskDetail['cycle']['prescription_intakes'][number] | null;
  prefill: DispensePrefillResult | null | undefined;
}) {
  const medicationChanges = prefill?.medicationChanges ?? [];
  const dateWarnings = prefill?.dateWarnings ?? [];
  const supplementalRecords = normalizeJahisSupplementalRecords(
    undefined,
    intake.jahis_supplemental_records,
  );
  const summaryItems = [
    {
      label: '取込',
      value: sourceTypeLabel[intake.source_type] ?? intake.source_type,
      tone:
        intake.source_type === 'qr_scan' ? 'bg-sky-100 text-sky-800' : 'bg-muted text-foreground',
    },
    {
      label: '前回処方',
      value: previousIntake ? 'あり' : 'なし',
      tone: previousIntake ? 'bg-emerald-100 text-emerald-800' : 'bg-muted text-muted-foreground',
    },
    {
      label: '変更',
      value: `${medicationChanges.length}件`,
      tone:
        medicationChanges.length > 0
          ? 'bg-amber-100 text-amber-800'
          : 'bg-muted text-muted-foreground',
    },
    {
      label: '日付注意',
      value: `${dateWarnings.length}件`,
      tone:
        dateWarnings.length > 0 ? 'bg-amber-100 text-amber-800' : 'bg-muted text-muted-foreground',
    },
    {
      label: 'QR補足',
      value: `${supplementalRecords.length}件`,
      tone:
        supplementalRecords.length > 0
          ? 'bg-sky-100 text-sky-800'
          : 'bg-muted text-muted-foreground',
    },
  ];

  return (
    <Card className="border-sky-200 bg-sky-50/30">
      <CardHeader className="pb-3">
        <h2 className="font-heading text-base leading-snug font-medium">調剤前確認</h2>
        <p className="text-xs leading-5 text-muted-foreground">
          QR由来情報、前回処方、服用日付、処方変更を先に確認し、下の調剤実績入力へ進みます。
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {summaryItems.map((item) => (
            <div
              key={item.label}
              className="rounded-lg border border-border/70 bg-background px-3 py-2"
            >
              <p className="text-[11px] font-medium text-muted-foreground">{item.label}</p>
              <p
                className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${item.tone}`}
              >
                {item.value}
              </p>
            </div>
          ))}
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <Card className="bg-background">
            <CardHeader className="pb-3">
              <h3 className="font-heading text-sm leading-snug font-medium">処方由来情報</h3>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">取込種別</span>
                <Badge variant={intake.source_type === 'qr_scan' ? 'default' : 'outline'}>
                  {sourceTypeLabel[intake.source_type] ?? intake.source_type}
                </Badge>
              </div>
              <p className="text-muted-foreground">
                処方日{' '}
                <span className="font-medium text-foreground">
                  {formatMaybeDate(intake.prescribed_date)}
                </span>
              </p>
              <p className="text-muted-foreground">
                処方医{' '}
                <span className="font-medium text-foreground">{intake.prescriber_name ?? '—'}</span>
              </p>
              <p className="text-muted-foreground">
                医療機関{' '}
                <span className="font-medium text-foreground">
                  {intake.prescriber_institution ?? '—'}
                </span>
              </p>
            </CardContent>
          </Card>

          <Card className="bg-background xl:col-span-2">
            <CardHeader className="pb-3">
              <h3 className="font-heading text-sm leading-snug font-medium">服用日付</h3>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {intake.lines.map((line) => (
                  <div
                    key={line.id}
                    className="rounded-lg border border-border/70 bg-muted/20 p-3 text-sm"
                  >
                    <p className="font-medium text-foreground">{line.drug_name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatMaybeDate(line.start_date)} - {formatMaybeDate(line.end_date)}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card className="bg-background">
            <CardHeader className="pb-3">
              <h3 className="font-heading text-sm leading-snug font-medium">前回処方内容</h3>
            </CardHeader>
            <CardContent>
              {!previousIntake ? (
                <p className="text-sm text-muted-foreground">前回処方はありません。</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    処方日 {formatMaybeDate(previousIntake.prescribed_date)} /{' '}
                    {sourceTypeLabel[previousIntake.source_type] ?? previousIntake.source_type}
                  </p>
                  {previousIntake.lines.map((line) => (
                    <div
                      key={line.id}
                      className="rounded-lg border border-border/70 bg-background px-3 py-2 text-sm"
                    >
                      <p className="font-medium text-foreground">{line.drug_name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {line.dose} / {line.frequency} / {line.days}日
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        服用 {formatMaybeDate(line.start_date)} - {formatMaybeDate(line.end_date)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-background">
            <CardHeader className="pb-3">
              <h3 className="font-heading text-sm leading-snug font-medium">処方内容の変更</h3>
            </CardHeader>
            <CardContent>
              {medicationChanges.length === 0 ? (
                <p className="text-sm text-muted-foreground">前回処方との差分はありません。</p>
              ) : (
                <div className="space-y-2">
                  {medicationChanges.map((change) => (
                    <div
                      key={`${change.drug_name}-${change.change_type}`}
                      className="rounded-lg border border-border/70 bg-background px-3 py-2 text-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium text-foreground">{change.drug_name}</p>
                        <Badge variant="outline">{changeTypeLabel[change.change_type]}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {change.previous ? `${change.previous} → ` : ''}
                        {change.current ?? '中止'}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {dateWarnings.length > 0 && (
          <div className="space-y-2">
            {dateWarnings.map((warning) => (
              <div
                key={warning.lineId}
                className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <p>
                  {warning.type === 'gap'
                    ? `${warning.drugName}: 前回終了 ${warning.prevEndDate} → 今回開始 ${warning.currentStartDate}（${warning.gapDays}日間のギャップ）`
                    : `${warning.drugName}: 前回終了 ${warning.prevEndDate} → 今回開始 ${warning.currentStartDate}（${Math.abs(warning.gapDays)}日間の重複）`}
                </p>
              </div>
            ))}
          </div>
        )}

        <JahisSupplementalRecordsCard
          records={supplementalRecords}
          description="QRコード由来の手帳メモ、残薬確認、患者記入、かかりつけ薬剤師情報です。調剤前の確認に使用します。"
          gridClassName="grid gap-3 md:grid-cols-2"
        />
      </CardContent>
    </Card>
  );
}

type DispenseFormProps = {
  taskId: string;
};

type InquiryDialogState = {
  open: boolean;
  lineId: string | null;
  drugName: string;
  cycleId: string;
};

export function DispenseForm({ taskId }: DispenseFormProps) {
  const router = useRouter();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const isBootstrappingOrg = !orgId;
  const errorSummaryId = 'dispense-form-error-summary';
  const [historyOpen, setHistoryOpen] = useState(false);
  const [usePrefill, setUsePrefill] = useState(true);
  const [checkedLines, setCheckedLines] = useState<Set<string>>(new Set());
  const [safetyAck, setSafetyAck] = useState(false);
  const [editedLines, setEditedLines] = useState<Map<string, Partial<DispensePrefillLine>>>(
    new Map(),
  );
  const [unitDoseLines, setUnitDoseLines] = useState<Map<string, boolean>>(new Map());
  const [crushedLines, setCrushedLines] = useState<Map<string, boolean>>(new Map());
  const [inquiryDialog, setInquiryDialog] = useState<InquiryDialogState>({
    open: false,
    lineId: null,
    drugName: '',
    cycleId: '',
  });
  const [inquiryForm, setInquiryForm] = useState({
    reason: '',
    inquiry_to_physician: '',
    inquiry_content: '',
  });

  const { data: task, isLoading } = useQuery({
    queryKey: ['dispense-task', taskId, orgId],
    queryFn: async () => {
      const res = await fetch(`/api/dispense-tasks/${taskId}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('調剤タスクの取得に失敗しました');
      return res.json() as Promise<DispenseTaskDetail>;
    },
    enabled: !!orgId && !!taskId,
  });

  const {
    data: cdsData,
    isLoading: cdsLoading,
    isError: cdsError,
  } = useQuery<{ alerts: CdsAlert[] }>({
    queryKey: ['cds-alerts', task?.cycle.id, orgId],
    queryFn: async () => {
      const res = await fetch('/api/cds/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({ cycleId: task!.cycle.id }),
      });
      if (!res.ok) throw new Error('処方安全チェックに失敗しました');
      return res.json() as Promise<{ alerts: CdsAlert[] }>;
    },
    enabled: !!orgId && !!task?.cycle.id,
    retry: false,
  });

  const intake = task?.cycle.prescription_intakes[0];
  const previousIntake = task?.cycle.prescription_intakes[1] ?? null;
  const existingResultByLineId = toLineIdMap(task?.results ?? []);
  const stockGuidanceByLineId = toLineIdMap(task?.stock_guidance ?? []);
  const openInquiries = task?.cycle.inquiries ?? [];
  const cycleLevelInquiries = openInquiries.filter((item) => item.line_id == null);
  const blockedInquiryByLineId = toLineIdMap(
    openInquiries.filter((item): item is typeof item & { line_id: string } => item.line_id != null),
  );

  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: { lines: [] },
    values: intake
      ? {
          lines: intake.lines.map((line) => ({
            ...(existingResultByLineId.get(line.id)
              ? {
                  actual_drug_name:
                    existingResultByLineId.get(line.id)?.actual_drug_name ?? line.drug_name,
                  actual_drug_code:
                    existingResultByLineId.get(line.id)?.actual_drug_code ?? line.drug_code ?? '',
                  actual_quantity:
                    existingResultByLineId.get(line.id)?.actual_quantity ?? line.quantity ?? 0,
                  actual_unit: existingResultByLineId.get(line.id)?.actual_unit ?? line.unit ?? '',
                  discrepancy_reason: existingResultByLineId.get(line.id)?.discrepancy_reason ?? '',
                  carry_type: existingResultByLineId.get(line.id)?.carry_type ?? 'carry',
                  special_notes: existingResultByLineId.get(line.id)?.special_notes ?? '',
                }
              : {
                  actual_drug_name:
                    stockGuidanceByLineId.get(line.id)?.stock_status === 'preferred_generic'
                      ? (stockGuidanceByLineId.get(line.id)?.recommended_drug_name ??
                        line.drug_name)
                      : line.drug_name,
                  actual_drug_code:
                    stockGuidanceByLineId.get(line.id)?.stock_status === 'preferred_generic'
                      ? (stockGuidanceByLineId.get(line.id)?.recommended_drug_code ??
                        line.drug_code ??
                        '')
                      : (line.drug_code ?? ''),
                  actual_quantity: line.quantity ?? 0,
                  actual_unit: line.unit ?? '',
                  discrepancy_reason:
                    stockGuidanceByLineId.get(line.id)?.stock_status === 'preferred_generic'
                      ? '採用後発品へ変更'
                      : '',
                  carry_type: 'carry' as const,
                  special_notes: '',
                }),
            line_id: line.id,
          })),
        }
      : undefined,
  });

  const { fields } = useFieldArray({ control: form.control, name: 'lines' });

  const {
    registerCollaborative,
    awareness,
    getTextField,
    connected: yjsConnected,
  } = useCollaborativeForm({
    form,
    entityType: 'dispense_task',
    entityId: taskId,
    textFields: fields.map((_, i) => `lines.${i}.special_notes`),
  });

  const errorSummaryItems = collectFormErrorSummaryItems(form.formState.errors, {
    'lines.*.actual_drug_name': '実薬剤名',
    'lines.*.actual_quantity': '実数量',
  });

  const scrollToErrorSummary = useCallback(() => {
    if (typeof document === 'undefined') return;
    window.requestAnimationFrame(() => {
      const summary = document.getElementById(errorSummaryId);
      summary?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      summary?.focus();
    });
  }, [errorSummaryId]);

  const mutation = useMutation({
    mutationFn: async (values: FormOutput) => {
      const blockedLines = values.lines.filter((line) => blockedInquiryByLineId.has(line.line_id));
      if (cycleLevelInquiries.length > 0) {
        throw new Error('サイクル全体で疑義照会中のため調剤を開始できません');
      }
      if (blockedLines.length > 0) {
        throw new Error('疑義照会中の明細が含まれているため、その明細を除いて対応してください');
      }

      const res = await fetch('/api/dispense-results', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          task_id: taskId,
          lines: values.lines.filter((line) => !blockedInquiryByLineId.has(line.line_id)),
          safety_checklist: DISPENSE_SAFETY_CHECKLIST_ACK,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? '調剤実績の登録に失敗しました');
      }
      return res.json() as Promise<{ data?: { partial?: boolean } }>;
    },
    onSuccess: (result) => {
      const partial = result?.data?.partial ?? false;
      toast.success(partial ? '一部登録' : '調剤完了', {
        description: partial
          ? '未照会の明細を保存しました。疑義照会の解決後に残りを再開できます。'
          : '調剤実績を登録しました',
      });
      router.push('/dispensing');
    },
    onError: (err: Error) => {
      toast.error('エラー', { description: err.message });
    },
  });

  const prefillMutation = useMutation({
    mutationFn: async (lines: DispensePrefillLine[]) => {
      const groups = task?.prefill?.packagingGroups ?? [];
      const groupByLineId = new Map<string, PackagingGroupAssignment>(
        groups.map((g) => [g.lineId, g]),
      );

      const payload = {
        task_id: taskId,
        safety_checklist: DISPENSE_SAFETY_CHECKLIST_ACK,
        lines: lines
          .filter((line) => line.changeMarker !== 'removed')
          .map((line) => {
            const edited = editedLines.get(line.lineId) ?? {};
            const group = groupByLineId.get(line.lineId);
            const isGrouped = group?.groupId !== null && group?.groupId !== undefined;
            const unitDose = unitDoseLines.has(line.lineId)
              ? unitDoseLines.get(line.lineId)
              : isGrouped;
            return {
              line_id: line.lineId,
              actual_drug_name: edited.actualDrugName ?? line.actualDrugName,
              actual_drug_code: edited.actualDrugCode ?? line.actualDrugCode ?? undefined,
              actual_quantity: edited.actualQuantity ?? line.actualQuantity ?? 0,
              actual_unit: edited.actualUnit ?? line.actualUnit ?? undefined,
              carry_type: edited.carryType ?? line.carryType,
              special_notes: edited.specialNotes ?? line.specialNotes ?? undefined,
              discrepancy_reason: edited.discrepancyReason ?? line.discrepancyReason ?? undefined,
              is_unit_dose: unitDose,
              is_crushed: crushedLines.get(line.lineId) ?? false,
              packaging_group_id: group?.groupId ?? undefined,
            };
          }),
      };
      const res = await fetch('/api/dispense-results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? '調剤実績の登録に失敗しました');
      }
      return res.json() as Promise<{ data?: { partial?: boolean } }>;
    },
    onSuccess: (result) => {
      const partial = result?.data?.partial ?? false;
      toast.success(partial ? '一部登録' : '調剤完了', {
        description: partial
          ? '未照会の明細を保存しました。疑義照会の解決後に残りを再開できます。'
          : '調剤実績を登録しました',
      });
      router.push('/dispensing');
    },
    onError: (err: Error) => {
      toast.error('エラー', { description: err.message });
    },
  });

  const inquiryMutation = useMutation({
    mutationFn: async () => {
      const today = formatDateKey(new Date());
      const res = await fetch('/api/inquiry-records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({
          cycle_id: inquiryDialog.cycleId,
          line_id: inquiryDialog.lineId ?? undefined,
          reason: inquiryForm.reason,
          inquiry_to_physician: inquiryForm.inquiry_to_physician,
          inquiry_content: inquiryForm.inquiry_content,
          inquired_at: today,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? '疑義照会の起票に失敗しました');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('疑義照会を起票しました');
      setInquiryDialog({ open: false, lineId: null, drugName: '', cycleId: '' });
      setInquiryForm({ reason: '', inquiry_to_physician: '', inquiry_content: '' });
      queryClient.invalidateQueries({ queryKey: ['dispense-task', taskId, orgId] });
    },
    onError: (err: Error) => {
      toast.error('起票エラー', { description: err.message });
    },
  });

  if (isBootstrappingOrg || isLoading) return <Loading />;
  if (!task || !intake) {
    return <p className="text-sm text-muted-foreground">調剤タスクが見つかりません</p>;
  }

  const patient = task.cycle.case_.patient;
  const cdsCheckReady = Boolean(cdsData) && !cdsLoading && !cdsError;
  const cdsCheckUnavailable = Boolean(task?.cycle.id) && cdsError;
  const hasLineLevelBlock = blockedInquiryByLineId.size > 0;
  const availableLineCount = intake.lines.filter(
    (line) => !blockedInquiryByLineId.has(line.id),
  ).length;
  const submitBlocked =
    cycleLevelInquiries.length > 0 || availableLineCount === 0 || !safetyAck || !cdsCheckReady;
  const originalCollectionCheck = task.original_collection_check;

  // Prefill mode
  const isPrefillMode =
    usePrefill && task.prefill?.isPrefillAvailable === true && task.results.length === 0;
  const prefillLines: DispensePrefillLine[] = task.prefill?.lines ?? [];
  const allChecked =
    prefillLines.length > 0 &&
    prefillLines.every((line) => line.changeMarker === 'removed' || checkedLines.has(line.lineId));

  const togglePrefillLine = (lineId: string) => {
    setCheckedLines((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) {
        next.delete(lineId);
      } else {
        next.add(lineId);
      }
      return next;
    });
  };

  const updateEditedLine = (lineId: string, patch: Partial<DispensePrefillLine>) => {
    setEditedLines((prev) => {
      const next = new Map(prev);
      next.set(lineId, { ...(next.get(lineId) ?? {}), ...patch });
      return next;
    });
  };

  const applyStockCandidate = (
    index: number,
    candidate: {
      drug_name: string;
      yj_code: string;
      source: 'exact' | 'preferred_generic' | 'alternative';
    },
  ) => {
    form.setValue(`lines.${index}.actual_drug_name`, candidate.drug_name, {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue(`lines.${index}.actual_drug_code`, candidate.yj_code, {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue(
      `lines.${index}.discrepancy_reason`,
      candidate.source === 'preferred_generic'
        ? '採用後発品へ変更'
        : candidate.source === 'exact'
          ? ''
          : '欠品時代替候補',
      {
        shouldDirty: true,
        shouldValidate: true,
      },
    );
  };

  // Prefill mode UI (rendered outside the manual form)
  if (isPrefillMode) {
    return (
      <div className="space-y-6">
        {/* Top toolbar */}
        <ActionRail align="between">
          <div className="flex-1">
            <PreviousStageSummary cycleId={task.cycle.id} />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="ステータス遷移履歴を開く"
            onClick={() => setHistoryOpen(true)}
          >
            <History className="mr-1.5 size-3.5" aria-hidden="true" />
            履歴
          </Button>
        </ActionRail>

        <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>ステータス遷移履歴</SheetTitle>
              <SheetDescription>処方サイクルのステータス変更履歴</SheetDescription>
            </SheetHeader>
            <div className="mt-4">
              <StageTimeline cycleId={task.cycle.id} />
            </div>
          </SheetContent>
        </Sheet>

        {/* Patient header */}
        <PageSection
          title={`${patient.name} 様`}
          description={`処方医: ${intake.prescriber_name ?? '—'} / ${
            intake.prescriber_institution ?? '—'
          }`}
          actions={
            <Badge variant={priorityVariant[task.priority] ?? 'outline'}>
              {priorityLabel[task.priority] ?? task.priority}
            </Badge>
          }
          contentClassName="text-xs text-muted-foreground"
        >
          調剤拠点: {task.site?.name ?? '未設定'} / 訪問先: {task.facility_label ?? '自宅訪問'}
        </PageSection>

        <OriginalCollectionCheckSection
          check={originalCollectionCheck}
          onOpenPatientPrescriptions={() => router.push(`/patients/${patient.id}/prescriptions`)}
        />

        <DispensingInformationPanel
          intake={intake}
          previousIntake={previousIntake}
          prefill={task.prefill}
        />

        {/* Auto-prefill info banner */}
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>処方データから調剤内容を自動生成しました。各行を確認して承認してください。</p>
        </div>

        {/* Prefill lines table */}
        <div className="space-y-3">
          {prefillLines.map((line) => {
            const edited = editedLines.get(line.lineId) ?? {};
            const isChecked = checkedLines.has(line.lineId);
            const isRemoved = line.changeMarker === 'removed';
            const borderClass =
              line.changeMarker === 'added'
                ? 'border-l-4 border-l-green-500'
                : line.changeMarker === 'removed'
                  ? 'border-l-4 border-l-red-500'
                  : line.changeMarker === 'dose_changed'
                    ? 'border-l-4 border-l-amber-500'
                    : line.changeMarker === 'frequency_changed'
                      ? 'border-l-4 border-l-blue-500'
                      : '';

            return (
              <Card key={line.lineId} className={borderClass}>
                <CardHeader className="pb-2">
                  <div className="flex items-start gap-3">
                    {!isRemoved && (
                      <Checkbox
                        id={`prefill-check-${line.lineId}`}
                        checked={isChecked}
                        onCheckedChange={() => togglePrefillLine(line.lineId)}
                        className="mt-0.5 size-5"
                        aria-label={`${line.drugName} 確認済み`}
                      />
                    )}
                    <div className="flex-1">
                      <h3
                        className={`font-heading text-sm leading-snug font-medium ${
                          isRemoved ? 'text-muted-foreground line-through' : ''
                        }`}
                      >
                        {line.lineNumber}. {line.drugName}
                        {line.changeMarker && (
                          <Badge
                            variant="outline"
                            className={`ml-2 text-[10px] ${
                              line.changeMarker === 'added'
                                ? 'border-green-500 text-green-700'
                                : line.changeMarker === 'removed'
                                  ? 'border-red-500 text-red-700'
                                  : line.changeMarker === 'dose_changed'
                                    ? 'border-amber-500 text-amber-700'
                                    : 'border-blue-500 text-blue-700'
                            }`}
                          >
                            {line.changeMarker === 'added'
                              ? '新規追加'
                              : line.changeMarker === 'removed'
                                ? '削除'
                                : line.changeMarker === 'dose_changed'
                                  ? '用量変更'
                                  : '用法変更'}
                          </Badge>
                        )}
                      </h3>
                      {line.changeDetail?.previous && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          前回: {line.changeDetail.previous}
                        </p>
                      )}
                      {line.genericSuggestion?.available &&
                        line.genericSuggestion.genericDrugName && (
                          <Badge
                            variant="outline"
                            className="mt-1 text-[10px] border-emerald-400 text-emerald-700"
                          >
                            後発品: {line.genericSuggestion.genericDrugName}
                          </Badge>
                        )}
                    </div>
                    {!isRemoved && (
                      <label
                        htmlFor={`prefill-check-${line.lineId}`}
                        className="cursor-pointer text-xs font-medium text-muted-foreground"
                      >
                        確認済み
                      </label>
                    )}
                  </div>
                </CardHeader>
                {!isRemoved && (
                  <CardContent className="space-y-3">
                    <Separator />
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <p id={`prefill-line-context-${line.lineId}`} className="sr-only">
                          {line.drugName} の調剤実績入力
                        </p>
                        <Label
                          htmlFor={`prefill-actual-drug-name-${line.lineId}`}
                          className="text-xs"
                        >
                          実薬剤名
                        </Label>
                        <Input
                          id={`prefill-actual-drug-name-${line.lineId}`}
                          value={edited.actualDrugName ?? line.actualDrugName}
                          onChange={(e) =>
                            updateEditedLine(line.lineId, { actualDrugName: e.target.value })
                          }
                          aria-describedby={`prefill-line-context-${line.lineId}`}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label
                          htmlFor={`prefill-actual-quantity-${line.lineId}`}
                          className="text-xs"
                        >
                          数量
                        </Label>
                        <div className="flex items-center gap-2">
                          <Input
                            id={`prefill-actual-quantity-${line.lineId}`}
                            type="number"
                            step="0.1"
                            value={edited.actualQuantity ?? line.actualQuantity ?? ''}
                            onChange={(e) =>
                              updateEditedLine(line.lineId, {
                                actualQuantity: parseFloat(e.target.value),
                              })
                            }
                            aria-describedby={`prefill-line-context-${line.lineId}`}
                            className="h-8 w-24 text-sm"
                          />
                          <Input
                            id={`prefill-actual-unit-${line.lineId}`}
                            value={edited.actualUnit ?? line.actualUnit ?? ''}
                            onChange={(e) =>
                              updateEditedLine(line.lineId, { actualUnit: e.target.value })
                            }
                            aria-label={`${line.drugName} の単位`}
                            aria-describedby={`prefill-line-context-${line.lineId}`}
                            className="h-8 w-20 text-sm"
                            placeholder="単位"
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`prefill-carry-type-${line.lineId}`} className="text-xs">
                          持参区分
                        </Label>
                        <Select
                          value={edited.carryType ?? line.carryType}
                          onValueChange={(v) =>
                            updateEditedLine(line.lineId, {
                              carryType: v as DispensePrefillLine['carryType'],
                            })
                          }
                        >
                          <SelectTrigger
                            id={`prefill-carry-type-${line.lineId}`}
                            className="h-8 text-sm"
                            aria-describedby={`prefill-line-context-${line.lineId}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CARRY_TYPE_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>

        {/* Packaging groups section — grouped unit-dose / crush toggles */}
        {(() => {
          const groups = task.prefill?.packagingGroups ?? [];
          if (groups.length === 0) return null;

          // Collect unique groupIds (excluding null = ungrouped)
          const groupIds = Array.from(
            new Set(groups.map((g) => g.groupId).filter((id): id is string => id !== null)),
          );

          // Lines in each named group
          const groupedLinesByGroupId = new Map<string, PackagingGroupAssignment[]>();
          for (const g of groups) {
            if (g.groupId === null) continue;
            const existing = groupedLinesByGroupId.get(g.groupId) ?? [];
            existing.push(g);
            groupedLinesByGroupId.set(g.groupId, existing);
          }

          // Ungrouped lines (PRN / external / unknown)
          const ungroupedLines = groups.filter((g) => g.groupId === null);

          if (groupIds.length === 0 && ungroupedLines.length === 0) return null;

          const getUnitDose = (lineId: string, groupId: string | null) => {
            if (unitDoseLines.has(lineId)) return unitDoseLines.get(lineId)!;
            return groupId !== null; // default ON for grouped, OFF for ungrouped
          };
          const getCrushed = (lineId: string) => crushedLines.get(lineId) ?? false;

          const setUnitDose = (lineId: string, value: boolean) => {
            setUnitDoseLines((prev) => new Map(prev).set(lineId, value));
          };
          const setCrushed = (lineId: string, value: boolean) => {
            setCrushedLines((prev) => new Map(prev).set(lineId, value));
          };

          const renderLine = (g: PackagingGroupAssignment) => {
            const prefillLine = prefillLines.find((l) => l.lineId === g.lineId);
            if (!prefillLine) return null;
            const unitDose = getUnitDose(g.lineId, g.groupId);
            const crushed = getCrushed(g.lineId);
            const showCrushWarning = crushed && g.isCrushProhibited;

            return (
              <div key={g.lineId} className="space-y-2 rounded-md border border-border p-3">
                <p className="text-sm font-medium">
                  {prefillLine.lineNumber}. {prefillLine.drugName}
                </p>
                <div className="flex flex-wrap items-center gap-4">
                  {g.groupId !== null && (
                    <div className="flex items-center gap-2">
                      <Switch
                        id={`unit-dose-${g.lineId}`}
                        checked={unitDose}
                        onCheckedChange={(v) => setUnitDose(g.lineId, v)}
                        aria-label="一包化"
                      />
                      <Label htmlFor={`unit-dose-${g.lineId}`} className="text-xs">
                        一包化
                      </Label>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Switch
                      id={`crush-${g.lineId}`}
                      checked={crushed}
                      onCheckedChange={(v) => setCrushed(g.lineId, v)}
                      aria-label="粉砕"
                    />
                    <Label htmlFor={`crush-${g.lineId}`} className="text-xs">
                      粉砕
                    </Label>
                  </div>
                </div>
                {showCrushWarning && (
                  <div className="flex items-center gap-1.5 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800 border border-amber-300">
                    <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                    粉砕禁止薬です
                  </div>
                )}
              </div>
            );
          };

          return (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">一包化・粉砕設定</h3>

              {groupIds.map((groupId) => {
                const linesInGroup = groupedLinesByGroupId.get(groupId) ?? [];
                const label = linesInGroup[0]?.groupLabel ?? groupId;
                return (
                  <Card key={groupId}>
                    <CardHeader className="pb-2">
                      <h4 className="font-heading text-sm leading-snug font-medium">{label}</h4>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {linesInGroup.map((g) => renderLine(g))}
                    </CardContent>
                  </Card>
                );
              })}

              {ungroupedLines.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <h4 className="font-heading text-sm leading-snug font-medium text-muted-foreground">
                      個別包装
                    </h4>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {ungroupedLines.map((g) => renderLine(g))}
                  </CardContent>
                </Card>
              )}
            </div>
          );
        })()}

        <Card className="border-amber-300 bg-amber-50/60">
          <CardHeader className="pb-2">
            <h3 className="flex items-center gap-2 font-heading text-sm leading-snug font-medium text-amber-950">
              <AlertTriangle className="size-4" aria-hidden="true" />
              調剤完了前の安全確認
            </h3>
          </CardHeader>
          <CardContent className="space-y-3">
            <CdsAlertPanel
              alerts={cdsData?.alerts ?? []}
              isLoading={cdsLoading}
              isUnavailable={cdsCheckUnavailable}
            />
            <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-background px-3 py-3">
              <Checkbox
                id="prefill-dispense-safety-ack"
                checked={safetyAck}
                onCheckedChange={(checked) => setSafetyAck(Boolean(checked))}
                disabled={!cdsCheckReady}
              />
              <Label
                htmlFor="prefill-dispense-safety-ack"
                className="text-sm leading-5 text-amber-950"
              >
                患者、薬剤名・規格、数量・日数、用法、包装・保管、処方安全アラートを確認しました
              </Label>
            </div>
          </CardContent>
        </Card>

        {/* Prefill action buttons */}
        <ActionRail>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setUsePrefill(false);
            }}
            disabled={prefillMutation.isPending}
          >
            手動入力に切替
          </Button>
          <LoadingButton
            type="button"
            loading={prefillMutation.isPending}
            loadingLabel="登録中..."
            disabled={!allChecked || !safetyAck || !cdsCheckReady}
            aria-label="自動生成された調剤内容を承認して登録"
            onClick={() => prefillMutation.mutate(prefillLines)}
          >
            承認
          </LoadingButton>
        </ActionRail>
      </div>
    );
  }

  return (
    <form
      onSubmit={form.handleSubmit((values) => mutation.mutate(values), scrollToErrorSummary)}
      className="space-y-6"
    >
      <FormErrorSummary id={errorSummaryId} items={errorSummaryItems} />

      <ActionRail align="between">
        <div className="flex-1">
          <PreviousStageSummary cycleId={task.cycle.id} />
        </div>
        <ActionRail>
          <PresenceAvatars entityType="dispense_task" entityId={taskId} />
          {yjsConnected && (
            <span
              role="status"
              aria-live="polite"
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
              title="共同編集接続中"
            >
              <span
                className="inline-block size-1.5 rounded-full bg-emerald-500"
                aria-hidden="true"
              />
              同期中
            </span>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="ステータス遷移履歴を開く"
            onClick={() => setHistoryOpen(true)}
          >
            <History className="mr-1.5 size-3.5" aria-hidden="true" />
            履歴
          </Button>
        </ActionRail>
      </ActionRail>

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>ステータス遷移履歴</SheetTitle>
            <SheetDescription>処方サイクルのステータス変更履歴</SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            <StageTimeline cycleId={task.cycle.id} />
          </div>
        </SheetContent>
      </Sheet>

      {/* Task header */}
      <PageSection
        title={`${patient.name} 様`}
        description={`処方医: ${intake.prescriber_name ?? '—'} / ${
          intake.prescriber_institution ?? '—'
        }`}
        actions={
          <Badge variant={priorityVariant[task.priority] ?? 'outline'}>
            {priorityLabel[task.priority] ?? task.priority}
          </Badge>
        }
        contentClassName="space-y-3 text-xs text-muted-foreground"
      >
        <p>
          調剤拠点: {task.site?.name ?? '未設定'} / 訪問先: {task.facility_label ?? '自宅訪問'}
        </p>
        {(cycleLevelInquiries.length > 0 || hasLineLevelBlock) && (
          <div>
            {cycleLevelInquiries.length > 0 ? (
              <InquiryBlockingAlert
                message="疑義照会中のため、この処方は調剤開始できません。"
                reason={cycleLevelInquiries[0]?.reason}
                physicianNote={cycleLevelInquiries[0]?.inquiry_to_physician}
                detail={
                  cycleLevelInquiries[0]?.change_detail ?? cycleLevelInquiries[0]?.inquiry_content
                }
                proposalOrigin={cycleLevelInquiries[0]?.proposal_origin}
                residualAdjustment={cycleLevelInquiries[0]?.residual_adjustment}
              />
            ) : (
              <InquiryBlockingAlert
                message="疑義照会中の明細は入力をロックしています。"
                reason="未照会の明細だけ先に調剤登録できます。"
              />
            )}
          </div>
        )}
      </PageSection>

      <OriginalCollectionCheckSection
        check={originalCollectionCheck}
        onOpenPatientPrescriptions={() => router.push(`/patients/${patient.id}/prescriptions`)}
      />

      <DispensingInformationPanel
        intake={intake}
        previousIntake={previousIntake}
        prefill={task.prefill}
      />

      {/* Prescription lines with dispense result inputs */}
      <div className="space-y-4">
        {fields.map((field, index) => {
          const originalLine = intake.lines[index];
          const stockGuidance = originalLine
            ? (stockGuidanceByLineId.get(originalLine.id) ?? null)
            : null;
          const blockedInquiry = originalLine
            ? (blockedInquiryByLineId.get(originalLine.id) ?? null)
            : null;
          const errors = form.formState.errors.lines?.[index];
          return (
            <Card key={field.id}>
              <CardHeader className="pb-2">
                <h3 className="font-heading text-sm leading-snug font-medium">
                  {index + 1}. {originalLine?.drug_name}
                  {originalLine?.dosage_form && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {originalLine.dosage_form}
                    </span>
                  )}
                </h3>
                <p className="text-xs text-muted-foreground">
                  処方: {originalLine?.dose} / {originalLine?.frequency} / {originalLine?.days}日分
                  {originalLine?.quantity != null &&
                    ` (${originalLine.quantity}${originalLine.unit ?? ''})`}
                </p>
                {originalLine?.packaging_instructions && (
                  <p className="text-xs text-orange-600">
                    包装指示: {originalLine.packaging_instructions}
                  </p>
                )}
                {stockGuidance ? (
                  <div
                    className={`mt-2 rounded-md border px-2.5 py-2 text-xs ${
                      stockGuidance.stock_status === 'out_of_stock'
                        ? 'border-destructive/30 bg-destructive/5 text-destructive'
                        : stockGuidance.stock_status === 'preferred_generic'
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                          : stockGuidance.stock_status === 'alternative_available'
                            ? 'border-amber-300 bg-amber-50 text-amber-900'
                            : 'border-border bg-muted/40 text-foreground'
                    }`}
                  >
                    <p className="font-medium">
                      在庫参照: {stockGuidance.message}
                      {task.site?.name ? `（${task.site.name}）` : ''}
                    </p>
                    {stockGuidance.stocked_candidates.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {stockGuidance.stocked_candidates.slice(0, 4).map((candidate) => (
                          <Button
                            key={`${field.id}-${candidate.drug_master_id}`}
                            type="button"
                            variant={
                              candidate.source === 'preferred_generic' ? 'default' : 'outline'
                            }
                            size="sm"
                            className="h-7 text-[11px]"
                            aria-label={`${candidate.drug_name} を実薬剤として適用`}
                            onClick={() => applyStockCandidate(index, candidate)}
                            disabled={!!blockedInquiry || cycleLevelInquiries.length > 0}
                          >
                            {candidate.drug_name}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
                {blockedInquiry ? (
                  <div className="mt-2">
                    <InquiryBlockingAlert
                      message="疑義照会中のためこの明細は調剤を開始できません。"
                      reason={blockedInquiry.reason}
                      physicianNote={blockedInquiry.inquiry_to_physician}
                      detail={blockedInquiry.change_detail ?? blockedInquiry.inquiry_content}
                      proposalOrigin={blockedInquiry.proposal_origin}
                      residualAdjustment={blockedInquiry.residual_adjustment}
                    />
                  </div>
                ) : (
                  <div className="mt-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-amber-700 border-amber-300 hover:bg-amber-50"
                      onClick={() => {
                        setInquiryDialog({
                          open: true,
                          lineId: originalLine?.id ?? null,
                          drugName: originalLine?.drug_name ?? '',
                          cycleId: task.cycle.id,
                        });
                        setInquiryForm({
                          reason: '',
                          inquiry_to_physician: '',
                          inquiry_content: '',
                        });
                      }}
                    >
                      <MessageSquarePlus className="size-3.5" aria-hidden="true" />
                      疑義照会を起票
                    </Button>
                  </div>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                <Separator />
                <p className="text-xs font-medium text-muted-foreground">調剤実績入力</p>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor={`lines.${index}.actual_drug_name`} className="text-xs">
                      実薬剤名 <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id={`lines.${index}.actual_drug_name`}
                      {...registerCollaborative(`lines.${index}.actual_drug_name`)}
                      className="h-8 text-sm"
                      aria-invalid={!!errors?.actual_drug_name}
                      disabled={!!blockedInquiry || cycleLevelInquiries.length > 0}
                    />
                    {errors?.actual_drug_name && (
                      <p className="text-xs text-destructive" role="alert">
                        {errors.actual_drug_name.message}
                      </p>
                    )}
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor={`lines.${index}.actual_drug_code`} className="text-xs">
                      YJコード
                    </Label>
                    <Input
                      id={`lines.${index}.actual_drug_code`}
                      {...registerCollaborative(`lines.${index}.actual_drug_code`)}
                      className="h-8 font-mono text-sm"
                      placeholder="例: 1234567890123"
                      disabled={!!blockedInquiry || cycleLevelInquiries.length > 0}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor={`lines.${index}.actual_quantity`} className="text-xs">
                      実数量 <span className="text-destructive">*</span>
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id={`lines.${index}.actual_quantity`}
                        type="number"
                        step="0.1"
                        {...registerCollaborative(`lines.${index}.actual_quantity`)}
                        className="h-8 w-24 text-sm"
                        aria-invalid={!!errors?.actual_quantity}
                        disabled={!!blockedInquiry || cycleLevelInquiries.length > 0}
                      />
                      <Input
                        {...registerCollaborative(`lines.${index}.actual_unit`)}
                        className="h-8 w-20 text-sm"
                        placeholder="単位"
                        disabled={!!blockedInquiry || cycleLevelInquiries.length > 0}
                      />
                    </div>
                    {errors?.actual_quantity && (
                      <p className="text-xs text-destructive" role="alert">
                        {errors.actual_quantity.message}
                      </p>
                    )}
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor={`lines.${index}.carry_type`} className="text-xs">
                      持参区分 <span className="text-destructive">*</span>
                    </Label>
                    <Controller
                      control={form.control}
                      name={`lines.${index}.carry_type`}
                      render={({ field }) => (
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                          disabled={!!blockedInquiry || cycleLevelInquiries.length > 0}
                        >
                          <SelectTrigger id={`lines.${index}.carry_type`} className="h-8 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CARRY_TYPE_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label htmlFor={`lines.${index}.discrepancy_reason`} className="text-xs">
                    差異理由（処方と異なる場合）
                  </Label>
                  <Input
                    id={`lines.${index}.discrepancy_reason`}
                    {...registerCollaborative(`lines.${index}.discrepancy_reason`)}
                    className="h-8 text-sm"
                    placeholder="例: 後発品に変更"
                    disabled={!!blockedInquiry || cycleLevelInquiries.length > 0}
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor={`lines.${index}.special_notes`} className="text-xs">
                    特記事項（冷所保管・麻薬・半割等）
                  </Label>
                  {awareness && getTextField(`lines.${index}.special_notes`) ? (
                    <CollaborativeTextarea
                      id={`lines.${index}.special_notes`}
                      yText={getTextField(`lines.${index}.special_notes`)!}
                      awareness={awareness}
                      className="min-h-[60px] text-sm"
                      placeholder="例: 冷所保管"
                      disabled={!!blockedInquiry || cycleLevelInquiries.length > 0}
                      onValueChange={(value, { local }) => {
                        form.setValue(`lines.${index}.special_notes`, value, {
                          shouldDirty: local,
                          shouldValidate: false,
                        });
                      }}
                    />
                  ) : (
                    <Textarea
                      id={`lines.${index}.special_notes`}
                      {...form.register(`lines.${index}.special_notes`)}
                      className="min-h-[60px] text-sm"
                      placeholder="例: 冷所保管"
                      disabled={!!blockedInquiry || cycleLevelInquiries.length > 0}
                    />
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="border-amber-300 bg-amber-50/60">
        <CardHeader className="pb-2">
          <h2 className="flex items-center gap-2 font-heading text-sm leading-snug font-medium text-amber-950">
            <AlertTriangle className="size-4" aria-hidden="true" />
            調剤完了前の安全確認
          </h2>
        </CardHeader>
        <CardContent className="space-y-3">
          <CdsAlertPanel
            alerts={cdsData?.alerts ?? []}
            isLoading={cdsLoading}
            isUnavailable={cdsCheckUnavailable}
          />
          <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-background px-3 py-3">
            <Checkbox
              id="manual-dispense-safety-ack"
              checked={safetyAck}
              onCheckedChange={(checked) => setSafetyAck(Boolean(checked))}
              disabled={!cdsCheckReady}
            />
            <Label
              htmlFor="manual-dispense-safety-ack"
              className="text-sm leading-5 text-amber-950"
            >
              患者、薬剤名・規格、数量・日数、用法、包装・保管、処方安全アラートを確認しました
            </Label>
          </div>
        </CardContent>
      </Card>

      <ActionRail>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push('/dispensing')}
          disabled={mutation.isPending}
        >
          キャンセル
        </Button>
        <LoadingButton
          type="submit"
          loading={mutation.isPending}
          loadingLabel="登録中..."
          disabled={submitBlocked}
        >
          調剤完了
        </LoadingButton>
      </ActionRail>

      {/* Inquiry filing dialog */}
      <Dialog
        open={inquiryDialog.open}
        onOpenChange={(open) => setInquiryDialog((prev) => ({ ...prev, open }))}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">疑義照会を起票</DialogTitle>
            {inquiryDialog.drugName && (
              <p className="text-xs text-muted-foreground">対象: {inquiryDialog.drugName}</p>
            )}
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="inq-reason" className="text-xs">
                照会理由 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="inq-reason"
                value={inquiryForm.reason}
                onChange={(e) => setInquiryForm((p) => ({ ...p, reason: e.target.value }))}
                placeholder="例: 用量疑義 / 相互作用 / 禁忌確認"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="inq-physician" className="text-xs">
                照会先医師名 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="inq-physician"
                value={inquiryForm.inquiry_to_physician}
                onChange={(e) =>
                  setInquiryForm((p) => ({ ...p, inquiry_to_physician: e.target.value }))
                }
                placeholder="例: 田中 太郎"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="inq-content" className="text-xs">
                照会内容 <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="inq-content"
                value={inquiryForm.inquiry_content}
                onChange={(e) => setInquiryForm((p) => ({ ...p, inquiry_content: e.target.value }))}
                placeholder="照会する具体的な内容を記入してください"
                className="min-h-[80px] text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setInquiryDialog((prev) => ({ ...prev, open: false }))}
              disabled={inquiryMutation.isPending}
            >
              キャンセル
            </Button>
            <LoadingButton
              type="button"
              loading={inquiryMutation.isPending}
              loadingLabel="起票中..."
              disabled={
                !inquiryForm.reason.trim() ||
                !inquiryForm.inquiry_to_physician.trim() ||
                !inquiryForm.inquiry_content.trim()
              }
              onClick={() => inquiryMutation.mutate()}
            >
              起票する
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
