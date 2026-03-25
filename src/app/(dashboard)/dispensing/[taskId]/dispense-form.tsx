'use client';

import { useRouter } from 'next/navigation';
import { useForm, useFieldArray } from 'react-hook-form';
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
  };
};

const lineResultSchema = z.object({
  line_id: z.string(),
  actual_drug_name: z.string().min(1, '実薬剤名は必須です'),
  actual_drug_code: z.string().optional(),
  actual_quantity: z.coerce
    .number({ invalid_type_error: '数量を入力してください' })
    .positive('正の数を入力してください'),
  actual_unit: z.string().optional(),
  discrepancy_reason: z.string().optional(),
  carry_type: z.enum(['carry', 'facility_deposit', 'deferred']),
  special_notes: z.string().optional(),
});

const formSchema = z.object({
  lines: z.array(lineResultSchema),
});

type FormValues = z.infer<typeof formSchema>;

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

  const { data: task, isLoading } = useQuery({
    queryKey: ['dispense-task', taskId, orgId],
    queryFn: async () => {
      // Fetch task detail from dispense-queue filtered by id
      const res = await fetch('/api/dispense-queue', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('調剤タスクの取得に失敗しました');
      const json = (await res.json()) as { data: DispenseTaskDetail[] };
      const found = json.data.find((t) => t.id === taskId);
      if (!found) throw new Error('調剤タスクが見つかりません');
      return found;
    },
    enabled: !!orgId && !!taskId,
  });

  const intake = task?.cycle.prescription_intakes[0];

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { lines: [] },
    values: intake
      ? {
          lines: intake.lines.map((line) => ({
            line_id: line.id,
            actual_drug_name: line.drug_name,
            actual_drug_code: line.drug_code ?? '',
            actual_quantity: line.quantity ?? 0,
            actual_unit: line.unit ?? '',
            discrepancy_reason: '',
            carry_type: 'carry' as const,
            special_notes: '',
          })),
        }
      : undefined,
  });

  const { fields } = useFieldArray({ control: form.control, name: 'lines' });

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const res = await fetch('/api/dispense-results', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({ task_id: taskId, lines: values.lines }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { message?: string }).message ?? '調剤実績の登録に失敗しました'
        );
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('調剤完了', { description: '調剤実績を登録しました' });
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

  return (
    <form
      onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      className="space-y-6"
    >
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
        </CardHeader>
      </Card>

      {/* Prescription lines with dispense result inputs */}
      <div className="space-y-4">
        {fields.map((field, index) => {
          const originalLine = intake.lines[index];
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
                      />
                      <Input
                        {...form.register(`lines.${index}.actual_unit`)}
                        className="h-8 w-20 text-sm"
                        placeholder="単位"
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
                    <Select
                      value={form.watch(`lines.${index}.carry_type`)}
                      onValueChange={(v) => {
                        if (v) {
                          form.setValue(
                            `lines.${index}.carry_type`,
                            v as 'carry' | 'facility_deposit' | 'deferred'
                          );
                        }
                      }}
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
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? '登録中...' : '調剤完了'}
        </Button>
      </div>
    </form>
  );
}
