'use client';

import { useRouter } from 'next/navigation';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  MessageSquare,
  Eye,
  Brain,
  ClipboardList,
  User,
  CalendarCheck,
} from 'lucide-react';
import { z } from 'zod';
import { createVisitRecordSchema } from '@/lib/validations/visit-record';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ResidualMedicationForm } from '@/components/features/visits/residual-medication-form';

type ScheduleDetail = {
  id: string;
  patient_id: string;
  scheduled_date: string;
  visit_type: string;
  recurrence_rule?: string | null;
};

const outcomeOptions = [
  { value: 'completed', label: '完了' },
  { value: 'revisit_needed', label: '再訪必要' },
  { value: 'postponed', label: '延期' },
  { value: 'cancelled', label: 'キャンセル' },
  { value: 'delivery_only', label: '投薬のみ' },
  { value: 'completed_with_issue', label: '完了（課題あり）' },
];

const relationOptions = [
  { value: 'self', label: '本人' },
  { value: 'spouse', label: '配偶者' },
  { value: 'child', label: '子' },
  { value: 'parent', label: '親' },
  { value: 'sibling', label: '兄弟姉妹' },
  { value: 'other_family', label: 'その他家族' },
  { value: 'caregiver', label: '介護者' },
  { value: 'facility_staff', label: '施設職員' },
  { value: 'other', label: 'その他' },
];

// Extend schema with residual_medications for form only
const formSchema = createVisitRecordSchema.extend({
  residual_medications: z
    .array(
      z.object({
        drug_name: z.string().min(1, '薬剤名は必須です'),
        drug_code: z.string().optional(),
        prescribed_quantity: z.number().optional(),
        prescribed_daily_dose: z.number().optional(),
        remaining_quantity: z.number().min(0),
        is_prohibited_reduction: z.boolean(),
      })
    )
    .optional(),
});

type FormValues = z.infer<typeof formSchema>;

export function VisitRecordForm({ scheduleId }: { scheduleId: string }) {
  const router = useRouter();
  const orgId = useOrgId();

  // Fetch schedule details
  const { data: schedule, isLoading: scheduleLoading } = useQuery<ScheduleDetail>({
    queryKey: ['schedule', scheduleId, orgId],
    queryFn: async () => {
      const res = await fetch(`/api/visit-schedules/${scheduleId}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('スケジュール情報の取得に失敗しました');
      return res.json();
    },
    enabled: !!orgId && !!scheduleId,
  });

  const today = format(new Date(), 'yyyy-MM-dd');

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      schedule_id: scheduleId,
      patient_id: schedule?.patient_id ?? '',
      visit_date: today,
      outcome_status: 'completed',
      soap_subjective: '',
      soap_objective: '',
      soap_assessment: '',
      soap_plan: '',
      receipt_person_name: '',
      receipt_person_relation: '',
      next_visit_suggestion_date: '',
      cancellation_reason: '',
      postpone_reason: '',
      revisit_reason: '',
      residual_medications: [],
    },
  });

  const outcomeStatus = form.watch('outcome_status');
  const visitDate = form.watch('visit_date');

  // Create visit record mutation
  const createRecord = useMutation({
    mutationFn: async (values: FormValues) => {
      const { residual_medications, ...recordData } = values;

      // Set patient_id from schedule if not yet set
      const payload = {
        ...recordData,
        patient_id: schedule?.patient_id ?? recordData.patient_id,
      };

      const res = await fetch('/api/visit-records', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? '訪問記録の保存に失敗しました');
      }

      const { record } = await res.json();

      // Post residual medications if any
      if (residual_medications && residual_medications.length > 0) {
        const medRes = await fetch('/api/residual-medications', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-org-id': orgId,
          },
          body: JSON.stringify({
            visit_record_id: record.id,
            medications: residual_medications,
          }),
        });
        if (!medRes.ok) {
          // Non-fatal: log but don't fail
          console.error('残薬記録の保存に失敗しました');
        }
      }

      return record;
    },
    onSuccess: (record) => {
      toast.success('訪問記録を保存しました');
      router.push(`/visits/${record.id}`);
    },
    onError: (err: Error) => {
      toast.error(err.message ?? '保存に失敗しました');
    },
  });

  function onSubmit(values: FormValues) {
    createRecord.mutate(values);
  }

  if (scheduleLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-muted-foreground">読み込み中...</p>
      </div>
    );
  }

  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
        {/* Hidden fields */}
        <input type="hidden" {...form.register('schedule_id')} />
        <input type="hidden" {...form.register('patient_id')} />

        <div className="space-y-4">
          {/* Visit date + Outcome */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="visit_date">
                訪問日 <span className="text-destructive" aria-label="必須">*</span>
              </Label>
              <Input
                id="visit_date"
                type="date"
                aria-invalid={!!form.formState.errors.visit_date}
                {...form.register('visit_date')}
              />
              {form.formState.errors.visit_date && (
                <p className="text-xs text-destructive" role="alert">
                  {form.formState.errors.visit_date.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="outcome_status">
                訪問結果 <span className="text-destructive" aria-label="必須">*</span>
              </Label>
              <Select
                value={outcomeStatus}
                onValueChange={(v) =>
                  form.setValue('outcome_status', v as FormValues['outcome_status'])
                }
              >
                <SelectTrigger id="outcome_status" className="w-full">
                  <SelectValue placeholder="訪問結果を選択" />
                </SelectTrigger>
                <SelectContent>
                  {outcomeOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Reason fields (conditional) */}
          {outcomeStatus === 'cancelled' && (
            <div className="space-y-1.5">
              <Label htmlFor="cancellation_reason">キャンセル理由</Label>
              <Textarea
                id="cancellation_reason"
                placeholder="キャンセルの理由を入力してください"
                rows={2}
                {...form.register('cancellation_reason')}
              />
            </div>
          )}
          {outcomeStatus === 'postponed' && (
            <div className="space-y-1.5">
              <Label htmlFor="postpone_reason">延期理由</Label>
              <Textarea
                id="postpone_reason"
                placeholder="延期の理由を入力してください"
                rows={2}
                {...form.register('postpone_reason')}
              />
            </div>
          )}
          {outcomeStatus === 'revisit_needed' && (
            <div className="space-y-1.5">
              <Label htmlFor="revisit_reason">再訪理由</Label>
              <Textarea
                id="revisit_reason"
                placeholder="再訪が必要な理由を入力してください"
                rows={2}
                {...form.register('revisit_reason')}
              />
            </div>
          )}

          {/* SOAP — tablet 2-column */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* S + O (left column) */}
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <MessageSquare className="size-4 text-blue-500" aria-hidden="true" />
                    S — 主観情報（患者の訴え）
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Textarea
                    id="soap_subjective"
                    placeholder="患者・家族からの訴え、服薬状況の自己申告など"
                    rows={5}
                    aria-label="主観情報"
                    {...form.register('soap_subjective')}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Eye className="size-4 text-green-500" aria-hidden="true" />
                    O — 客観情報（観察・計測）
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Textarea
                    id="soap_objective"
                    placeholder="残薬確認、保管状況、副作用観察、バイタル、介助者の様子など"
                    rows={5}
                    aria-label="客観情報"
                    {...form.register('soap_objective')}
                  />
                </CardContent>
              </Card>
            </div>

            {/* A + P (right column) */}
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Brain className="size-4 text-purple-500" aria-hidden="true" />
                    A — 薬学的評価
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Textarea
                    id="soap_assessment"
                    placeholder="処方の適正評価、相互作用、副作用リスク、アドヒアランス評価など"
                    rows={5}
                    aria-label="薬学的評価"
                    {...form.register('soap_assessment')}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <ClipboardList className="size-4 text-orange-500" aria-hidden="true" />
                    P — 計画・介入
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Textarea
                    id="soap_plan"
                    placeholder="介入内容、次回対応事項、多職種連携の要否、処方医への報告など"
                    rows={5}
                    aria-label="計画・介入"
                    {...form.register('soap_plan')}
                  />
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Receipt record */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <User className="size-4 text-muted-foreground" aria-hidden="true" />
                受領記録
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="receipt_person_name">受領者名</Label>
                  <Input
                    id="receipt_person_name"
                    placeholder="例: 山田 花子"
                    {...form.register('receipt_person_name')}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="receipt_person_relation">続柄</Label>
                  <Select
                    value={form.watch('receipt_person_relation') ?? ''}
                    onValueChange={(v) => form.setValue('receipt_person_relation', v ?? undefined)}
                  >
                    <SelectTrigger id="receipt_person_relation" className="w-full">
                      <SelectValue placeholder="続柄を選択" />
                    </SelectTrigger>
                    <SelectContent>
                      {relationOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="receipt_at">受領日時</Label>
                  <Input
                    id="receipt_at"
                    type="datetime-local"
                    defaultValue={`${visitDate}T00:00`}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Next visit suggestion */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <CalendarCheck className="size-4 text-muted-foreground" aria-hidden="true" />
                次回訪問提案
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="space-y-1.5">
                <Label htmlFor="next_visit_suggestion_date">次回提案日</Label>
                <Input
                  id="next_visit_suggestion_date"
                  type="date"
                  {...form.register('next_visit_suggestion_date')}
                />
              </div>
              {schedule?.recurrence_rule && (
                <p className="text-xs text-muted-foreground">
                  定期ルール: {schedule.recurrence_rule}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Residual medications */}
          <Card>
            <CardContent className="pt-4">
              <ResidualMedicationForm />
            </CardContent>
          </Card>

          {/* Submit */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
            >
              キャンセル
            </Button>
            <Button
              type="submit"
              disabled={createRecord.isPending}
            >
              {createRecord.isPending ? '保存中...' : '保存'}
            </Button>
          </div>
        </div>
      </form>
    </FormProvider>
  );
}
