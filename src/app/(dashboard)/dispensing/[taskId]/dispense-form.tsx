'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Controller, useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, History, Info, MessageSquarePlus } from 'lucide-react';
import { z } from 'zod';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { collectFormErrorSummaryItems } from '@/lib/forms/errors';
import { PresenceAvatars } from '@/components/features/collaboration/presence-avatars';
import { useCollaborativeForm } from '@/lib/hooks/use-collaborative-form';
import { CollaborativeTextarea } from '@/components/features/collaboration/collaborative-textarea';
import { CARRY_TYPE_OPTIONS } from '@/lib/dispensing/constants';
import type { DispensePrefillLine, DispensePrefillResult, PackagingGroupAssignment } from '@/lib/dispensing/prefill-generator';
import type { DateContinuityWarning } from '@/lib/dispensing/date-continuity';

function toLineIdMap<T extends { line_id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((x) => [x.line_id, x]));
}

function InquiryBlockingAlert({
  message,
  reason,
  physicianNote,
  detail,
}: {
  message: string;
  reason?: string;
  physicianNote?: string | null;
  detail?: string | null;
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
    </div>
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
      lines: PrescriptionLine[];
    }>;
    inquiries: Array<{
      id: string;
      line_id: string | null;
      reason: string;
      inquiry_to_physician: string | null;
      inquiry_content: string;
      result: string | null;
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
  const [editedLines, setEditedLines] = useState<Map<string, Partial<DispensePrefillLine>>>(new Map());
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

  const intake = task?.cycle.prescription_intakes[0];
  const existingResultByLineId = toLineIdMap(task?.results ?? []);
  const stockGuidanceByLineId = toLineIdMap(task?.stock_guidance ?? []);
  const openInquiries = task?.cycle.inquiries ?? [];
  const cycleLevelInquiries = openInquiries.filter((item) => item.line_id == null);
  const blockedInquiryByLineId = toLineIdMap(
    openInquiries
      .filter((item): item is typeof item & { line_id: string } => item.line_id != null)
  );

  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: { lines: [] },
    values: intake
      ? {
          lines: intake.lines.map((line) => ({
            ...(existingResultByLineId.get(line.id)
              ? {
                  actual_drug_name: existingResultByLineId.get(line.id)?.actual_drug_name ?? line.drug_name,
                  actual_drug_code: existingResultByLineId.get(line.id)?.actual_drug_code ?? line.drug_code ?? '',
                  actual_quantity: existingResultByLineId.get(line.id)?.actual_quantity ?? line.quantity ?? 0,
                  actual_unit: existingResultByLineId.get(line.id)?.actual_unit ?? line.unit ?? '',
                  discrepancy_reason: existingResultByLineId.get(line.id)?.discrepancy_reason ?? '',
                  carry_type: existingResultByLineId.get(line.id)?.carry_type ?? 'carry',
                  special_notes: existingResultByLineId.get(line.id)?.special_notes ?? '',
                }
              : {
                  actual_drug_name:
                    stockGuidanceByLineId.get(line.id)?.stock_status === 'preferred_generic'
                      ? (stockGuidanceByLineId.get(line.id)?.recommended_drug_name ?? line.drug_name)
                      : line.drug_name,
                  actual_drug_code:
                    stockGuidanceByLineId.get(line.id)?.stock_status === 'preferred_generic'
                      ? (stockGuidanceByLineId.get(line.id)?.recommended_drug_code ?? line.drug_code ?? '')
                      : line.drug_code ?? '',
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
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { message?: string }).message ?? '調剤実績の登録に失敗しました'
        );
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
        groups.map((g) => [g.lineId, g])
      );

      const payload = {
        task_id: taskId,
        results: lines
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
      const today = new Date().toISOString().slice(0, 10);
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
    return (
      <p className="text-sm text-muted-foreground">調剤タスクが見つかりません</p>
    );
  }

  const patient = task.cycle.case_.patient;
  const hasLineLevelBlock = blockedInquiryByLineId.size > 0;
  const availableLineCount = intake.lines.filter((line) => !blockedInquiryByLineId.has(line.id)).length;
  const submitBlocked = cycleLevelInquiries.length > 0 || availableLineCount === 0;
  const originalCollectionCheck = task.original_collection_check;

  // Prefill mode
  const isPrefillMode = usePrefill && task.prefill?.isPrefillAvailable === true && task.results.length === 0;
  const prefillLines: DispensePrefillLine[] = task.prefill?.lines ?? [];
  const prefillDateWarnings: DateContinuityWarning[] = task.prefill?.dateWarnings ?? [];
  const allChecked =
    prefillLines.length > 0 &&
    prefillLines.every(
      (line) => line.changeMarker === 'removed' || checkedLines.has(line.lineId)
    );

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
    }
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
      }
    );
  };

  // Prefill mode UI (rendered outside the manual form)
  if (isPrefillMode) {
    return (
      <div className="space-y-6">
        {/* Top toolbar */}
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <PreviousStageSummary cycleId={task.cycle.id} />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setHistoryOpen(true)}
          >
            <History className="mr-1.5 size-3.5" aria-hidden="true" />
            履歴
          </Button>
        </div>

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
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center gap-3">
              <CardTitle className="text-base">{patient.name} 様</CardTitle>
              <Badge variant={priorityVariant[task.priority] ?? 'outline'}>
                {priorityLabel[task.priority] ?? task.priority}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              処方医: {intake.prescriber_name ?? '—'} / {intake.prescriber_institution ?? '—'}
            </p>
            <p className="text-xs text-muted-foreground">
              調剤拠点: {task.site?.name ?? '未設定'} / 訪問先: {task.facility_label ?? '自宅訪問'}
            </p>
          </CardHeader>
        </Card>

        {originalCollectionCheck.required && (
          <Card className={originalCollectionCheck.collected ? 'border-emerald-200' : 'border-amber-300'}>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                {originalCollectionCheck.collected ? (
                  <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="size-4 text-amber-600" aria-hidden="true" />
                )}
                <CardTitle className="text-sm">処方せん原本の回収チェック</CardTitle>
                <Badge variant={originalCollectionCheck.collected ? 'outline' : 'secondary'}>
                  {originalCollectionCheck.collected ? '回収済み' : '要確認'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                FAX受付のため、調剤は進められますが、訪問時回収または後日郵送到着後に原本回収の記録が必須です。
              </p>
              {originalCollectionCheck.collected ? (
                <p className="text-emerald-700">
                  原本回収済み: {originalCollectionCheck.collected_at ?? '記録あり'}
                </p>
              ) : (
                <p className="text-amber-800">
                  未回収です。患者詳細の処方履歴から原本回収を記録してください。
                </p>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => router.push(`/patients/${patient.id}/prescriptions`)}
              >
                原本回収を確認
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Auto-prefill info banner */}
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>処方データから調剤内容を自動生成しました。各行を確認して承認してください。</p>
        </div>

        {/* Date warnings */}
        {prefillDateWarnings.length > 0 && (
          <div className="space-y-2">
            {prefillDateWarnings.map((w) => (
              <div
                key={w.lineId}
                className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <p>
                  {w.type === 'gap'
                    ? `⚠ ${w.drugName}: 前回終了 ${w.prevEndDate} → 今回開始 ${w.currentStartDate}（${w.gapDays}日間のギャップ）`
                    : `⚠ ${w.drugName}: 前回終了 ${w.prevEndDate} → 今回開始 ${w.currentStartDate}（${Math.abs(w.gapDays)}日間の重複）`}
                </p>
              </div>
            ))}
          </div>
        )}

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
                      <CardTitle className={`text-sm ${isRemoved ? 'text-muted-foreground line-through' : ''}`}>
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
                      </CardTitle>
                      {line.changeDetail?.previous && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          前回: {line.changeDetail.previous}
                        </p>
                      )}
                      {line.genericSuggestion?.available && line.genericSuggestion.genericDrugName && (
                        <Badge variant="outline" className="mt-1 text-[10px] border-emerald-400 text-emerald-700">
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
                        <Label className="text-xs">実薬剤名</Label>
                        <Input
                          value={edited.actualDrugName ?? line.actualDrugName}
                          onChange={(e) => updateEditedLine(line.lineId, { actualDrugName: e.target.value })}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">数量</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            step="0.1"
                            value={edited.actualQuantity ?? line.actualQuantity ?? ''}
                            onChange={(e) => updateEditedLine(line.lineId, { actualQuantity: parseFloat(e.target.value) })}
                            className="h-8 w-24 text-sm"
                          />
                          <Input
                            value={edited.actualUnit ?? line.actualUnit ?? ''}
                            onChange={(e) => updateEditedLine(line.lineId, { actualUnit: e.target.value })}
                            className="h-8 w-20 text-sm"
                            placeholder="単位"
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">持参区分</Label>
                        <Select
                          value={edited.carryType ?? line.carryType}
                          onValueChange={(v) => updateEditedLine(line.lineId, { carryType: v as DispensePrefillLine['carryType'] })}
                        >
                          <SelectTrigger className="h-8 text-sm">
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
            new Set(groups.map((g) => g.groupId).filter((id): id is string => id !== null))
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
                      <Label htmlFor={`unit-dose-${g.lineId}`} className="text-xs">一包化</Label>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Switch
                      id={`crush-${g.lineId}`}
                      checked={crushed}
                      onCheckedChange={(v) => setCrushed(g.lineId, v)}
                      aria-label="粉砕"
                    />
                    <Label htmlFor={`crush-${g.lineId}`} className="text-xs">粉砕</Label>
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
                      <CardTitle className="text-sm">{label}</CardTitle>
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
                    <CardTitle className="text-sm text-muted-foreground">個別包装</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {ungroupedLines.map((g) => renderLine(g))}
                  </CardContent>
                </Card>
              )}
            </div>
          );
        })()}

        {/* Prefill action buttons */}
        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => { setUsePrefill(false); }}
            disabled={prefillMutation.isPending}
          >
            手動入力に切替
          </Button>
          <LoadingButton
            type="button"
            loading={prefillMutation.isPending}
            loadingLabel="登録中..."
            disabled={!allChecked}
            onClick={() => prefillMutation.mutate(prefillLines)}
          >
            承認
          </LoadingButton>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={form.handleSubmit((values) => mutation.mutate(values), scrollToErrorSummary)}
      className="space-y-6"
    >
      <FormErrorSummary id={errorSummaryId} items={errorSummaryItems} />

      <div className="flex items-center gap-2">
        <div className="flex-1">
          <PreviousStageSummary cycleId={task.cycle.id} />
        </div>
        <PresenceAvatars entityType="dispense_task" entityId={taskId} />
        {yjsConnected && (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" title="共同編集接続中">
            <span className="inline-block size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            同期中
          </span>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setHistoryOpen(true)}
        >
          <History className="mr-1.5 size-3.5" aria-hidden="true" />
          履歴
        </Button>
      </div>

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
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle className="text-base">
              {patient.name} 様
            </CardTitle>
            <Badge variant={priorityVariant[task.priority] ?? 'outline'}>
              {priorityLabel[task.priority] ?? task.priority}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            処方医: {intake.prescriber_name ?? '—'} / {intake.prescriber_institution ?? '—'}
          </p>
          <p className="text-xs text-muted-foreground">
            調剤拠点: {task.site?.name ?? '未設定'} / 訪問先: {task.facility_label ?? '自宅訪問'}
          </p>
        </CardHeader>
        {(cycleLevelInquiries.length > 0 || hasLineLevelBlock) && (
          <CardContent className="pt-0">
            {cycleLevelInquiries.length > 0 ? (
              <InquiryBlockingAlert
                message="疑義照会中のため、この処方は調剤開始できません。"
                reason={cycleLevelInquiries[0]?.reason}
                physicianNote={cycleLevelInquiries[0]?.inquiry_to_physician}
              />
            ) : (
              <InquiryBlockingAlert
                message="疑義照会中の明細は入力をロックしています。"
                reason="未照会の明細だけ先に調剤登録できます。"
              />
            )}
          </CardContent>
        )}
      </Card>

      {/* Prescription lines with dispense result inputs */}
      <div className="space-y-4">
        {fields.map((field, index) => {
          const originalLine = intake.lines[index];
          const stockGuidance = originalLine
            ? stockGuidanceByLineId.get(originalLine.id) ?? null
            : null;
          const blockedInquiry = originalLine
            ? blockedInquiryByLineId.get(originalLine.id) ?? null
            : null;
          const errors = form.formState.errors.lines?.[index];
          return (
            <Card key={field.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  {index + 1}. {originalLine?.drug_name}
                  {originalLine?.dosage_form && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {originalLine.dosage_form}
                    </span>
                  )}
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  処方: {originalLine?.dose} / {originalLine?.frequency} / {originalLine?.days}日分
                  {originalLine?.quantity != null && ` (${originalLine.quantity}${originalLine.unit ?? ''})`}
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
                        setInquiryForm({ reason: '', inquiry_to_physician: '', inquiry_content: '' });
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
                    <Label
                      htmlFor={`lines.${index}.carry_type`}
                      className="text-xs"
                    >
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

      <div className="flex justify-end gap-3">
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
      </div>

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
                onChange={(e) =>
                  setInquiryForm((p) => ({ ...p, inquiry_content: e.target.value }))
                }
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
