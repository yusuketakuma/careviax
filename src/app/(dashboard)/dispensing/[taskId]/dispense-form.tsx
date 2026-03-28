'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Controller, useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import { useOrgId } from '@/lib/hooks/use-org-id';
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
import { Separator } from '@/components/ui/separator';
import { Loading } from '@/components/ui/loading';
import { FormErrorSummary } from '@/components/ui/form-error-summary';
import { LoadingButton } from '@/components/ui/loading-button';
import { collectFormErrorSummaryItems } from '@/lib/forms/errors';

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
      prescribed_date: string;
      prescriber_name: string | null;
      prescriber_institution: string | null;
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

const carryTypeOptions = [
  { value: 'carry', label: '持参' },
  { value: 'facility_deposit', label: '施設預け' },
  { value: 'deferred', label: '後日対応' },
];

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

export function DispenseForm({ taskId }: DispenseFormProps) {
  const router = useRouter();
  const orgId = useOrgId();
  const errorSummaryId = 'dispense-form-error-summary';

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
  const existingResultByLineId = new Map((task?.results ?? []).map((item) => [item.line_id, item]));
  const stockGuidanceByLineId = new Map(
    (task?.stock_guidance ?? []).map((item) => [item.line_id, item])
  );
  const openInquiries = task?.cycle.inquiries ?? [];
  const cycleLevelInquiries = openInquiries.filter((item) => item.line_id == null);
  const blockedInquiryByLineId = new Map(
    openInquiries
      .filter((item) => item.line_id)
      .map((item) => [item.line_id as string, item])
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

  if (isLoading) return <Loading />;
  if (!task || !intake) {
    return (
      <p className="text-sm text-muted-foreground">調剤タスクが見つかりません</p>
    );
  }

  const patient = task.cycle.case_.patient;
  const hasLineLevelBlock = blockedInquiryByLineId.size > 0;
  const availableLineCount = intake.lines.filter((line) => !blockedInquiryByLineId.has(line.id)).length;
  const submitBlocked = cycleLevelInquiries.length > 0 || availableLineCount === 0;
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

  return (
    <form
      onSubmit={form.handleSubmit((values) => mutation.mutate(values), scrollToErrorSummary)}
      className="space-y-6"
    >
      <FormErrorSummary id={errorSummaryId} items={errorSummaryItems} />

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
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <p className="font-medium">疑義照会中のため、この処方は調剤開始できません。</p>
                <p className="mt-1 text-xs">
                  {cycleLevelInquiries[0]?.reason}
                  {cycleLevelInquiries[0]?.inquiry_to_physician
                    ? ` / ${cycleLevelInquiries[0].inquiry_to_physician}`
                    : ''}
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <p className="font-medium">疑義照会中の明細は入力をロックしています。</p>
                <p className="mt-1 text-xs">
                  未照会の明細だけ先に調剤登録できます。
                </p>
              </div>
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
                  <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
                    <p className="font-medium">疑義照会中のためこの明細は調剤を開始できません。</p>
                    <p className="mt-1">
                      {blockedInquiry.reason}
                      {blockedInquiry.inquiry_to_physician
                        ? ` / ${blockedInquiry.inquiry_to_physician}`
                        : ''}
                    </p>
                    <p className="mt-1 text-amber-800">
                      {blockedInquiry.change_detail ?? blockedInquiry.inquiry_content}
                    </p>
                  </div>
                ) : null}
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
                      {...form.register(`lines.${index}.actual_drug_name`)}
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
                      {...form.register(`lines.${index}.actual_drug_code`)}
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
                        {...form.register(`lines.${index}.actual_quantity`)}
                        className="h-8 w-24 text-sm"
                        aria-invalid={!!errors?.actual_quantity}
                        disabled={!!blockedInquiry || cycleLevelInquiries.length > 0}
                      />
                      <Input
                        {...form.register(`lines.${index}.actual_unit`)}
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
                            {carryTypeOptions.map((opt) => (
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
                    {...form.register(`lines.${index}.discrepancy_reason`)}
                    className="h-8 text-sm"
                    placeholder="例: 後発品に変更"
                    disabled={!!blockedInquiry || cycleLevelInquiries.length > 0}
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor={`lines.${index}.special_notes`} className="text-xs">
                    特記事項（冷所保管・麻薬・半割等）
                  </Label>
                  <Textarea
                    id={`lines.${index}.special_notes`}
                    {...form.register(`lines.${index}.special_notes`)}
                    className="min-h-[60px] text-sm"
                    placeholder="例: 冷所保管"
                    disabled={!!blockedInquiry || cycleLevelInquiries.length > 0}
                  />
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
    </form>
  );
}
