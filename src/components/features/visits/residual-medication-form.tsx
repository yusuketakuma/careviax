'use client';

import { useFieldArray, useFormContext } from 'react-hook-form';
import { Plus, Trash2, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type ResidualMedicationEntry = {
  drug_name: string;
  drug_code?: string;
  prescribed_quantity?: number;
  prescribed_daily_dose?: number;
  remaining_quantity: number;
  is_prohibited_reduction: boolean;
};

type FormValues = {
  residual_medications: ResidualMedicationEntry[];
};

/**
 * Inline residual medication entry sub-form.
 * Must be used inside a react-hook-form <FormProvider>.
 */
export function ResidualMedicationForm() {
  const { register, watch, setValue, formState: { errors } } = useFormContext<FormValues>();
  const { fields, append, remove } = useFieldArray<FormValues>({
    name: 'residual_medications',
  });

  const medications = watch('residual_medications') ?? [];

  function calcExcessDays(remaining: number, dailyDose: number): number | null {
    if (!dailyDose || dailyDose <= 0 || remaining <= 0) return null;
    return Math.floor(remaining / dailyDose);
  }

  function handleAddMedication() {
    append({
      drug_name: '',
      drug_code: '',
      prescribed_quantity: undefined,
      prescribed_daily_dose: undefined,
      remaining_quantity: 0,
      is_prohibited_reduction: false,
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">残薬記録</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAddMedication}
          className="gap-1"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          薬剤を追加
        </Button>
      </div>

      {fields.length === 0 && (
        <p className="py-4 text-center text-sm text-muted-foreground">
          薬剤を追加してください
        </p>
      )}

      <div className="space-y-3">
        {fields.map((field, index) => {
          const med = medications[index];
          const remaining = Number(med?.remaining_quantity ?? 0);
          const dailyDose = Number(med?.prescribed_daily_dose ?? 0);
          const excessDays = calcExcessDays(remaining, dailyDose);
          const isProhibited = med?.is_prohibited_reduction ?? false;
          const hasError = !!(errors.residual_medications?.[index]);

          return (
            <div
              key={field.id}
              className={`rounded-lg border p-3 ${hasError ? 'border-destructive' : 'border-border'}`}
            >
              {/* Header row */}
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  薬剤 {index + 1}
                </span>
                <div className="flex items-center gap-2">
                  {isProhibited && (
                    <Badge variant="destructive" className="gap-1 text-xs">
                      <AlertTriangle className="size-3" aria-hidden="true" />
                      減数調剤禁止
                    </Badge>
                  )}
                  {excessDays !== null && excessDays > 7 && !isProhibited && (
                    <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                      余剰 {excessDays}日分
                    </Badge>
                  )}
                  {excessDays !== null && excessDays <= 7 && excessDays >= 0 && (
                    <Badge variant="outline" className="text-xs">
                      余剰 {excessDays}日分
                    </Badge>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => remove(index)}
                    aria-label={`薬剤 ${index + 1} を削除`}
                  >
                    <Trash2 className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  </Button>
                </div>
              </div>

              {/* Fields grid */}
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {/* Drug name */}
                <div className="col-span-2 space-y-1">
                  <Label htmlFor={`med-name-${index}`} className="text-xs">
                    薬剤名 <span className="text-destructive" aria-label="必須">*</span>
                  </Label>
                  <Input
                    id={`med-name-${index}`}
                    placeholder="例: アムロジピン錠5mg"
                    className="h-7 text-sm"
                    aria-invalid={!!errors.residual_medications?.[index]?.drug_name}
                    {...register(`residual_medications.${index}.drug_name`)}
                  />
                  {errors.residual_medications?.[index]?.drug_name && (
                    <p className="text-xs text-destructive" role="alert">
                      {errors.residual_medications[index].drug_name?.message}
                    </p>
                  )}
                </div>

                {/* Prescribed quantity */}
                <div className="space-y-1">
                  <Label htmlFor={`med-prescribed-${index}`} className="text-xs">
                    処方量
                  </Label>
                  <Input
                    id={`med-prescribed-${index}`}
                    type="number"
                    min={0}
                    step={0.5}
                    placeholder="処方量"
                    className="h-7 text-sm"
                    {...register(`residual_medications.${index}.prescribed_quantity`, {
                      valueAsNumber: true,
                    })}
                  />
                </div>

                {/* Remaining quantity */}
                <div className="space-y-1">
                  <Label htmlFor={`med-remaining-${index}`} className="text-xs">
                    残数 <span className="text-destructive" aria-label="必須">*</span>
                  </Label>
                  <Input
                    id={`med-remaining-${index}`}
                    type="number"
                    min={0}
                    step={0.5}
                    placeholder="残数"
                    className="h-7 text-sm"
                    aria-invalid={!!errors.residual_medications?.[index]?.remaining_quantity}
                    {...register(`residual_medications.${index}.remaining_quantity`, {
                      valueAsNumber: true,
                    })}
                  />
                  {errors.residual_medications?.[index]?.remaining_quantity && (
                    <p className="text-xs text-destructive" role="alert">
                      {errors.residual_medications[index].remaining_quantity?.message}
                    </p>
                  )}
                </div>

                {/* Daily dose */}
                <div className="space-y-1">
                  <Label htmlFor={`med-daily-${index}`} className="text-xs">
                    1日服用量
                  </Label>
                  <Input
                    id={`med-daily-${index}`}
                    type="number"
                    min={0}
                    step={0.5}
                    placeholder="1日量"
                    className="h-7 text-sm"
                    {...register(`residual_medications.${index}.prescribed_daily_dose`, {
                      valueAsNumber: true,
                    })}
                  />
                </div>

                {/* Prohibited reduction flag */}
                <div className="flex items-end space-x-2 pb-1">
                  <input
                    id={`med-prohibited-${index}`}
                    type="checkbox"
                    className="size-4 accent-destructive"
                    {...register(`residual_medications.${index}.is_prohibited_reduction`)}
                    onChange={(e) => {
                      setValue(
                        `residual_medications.${index}.is_prohibited_reduction`,
                        e.target.checked
                      );
                    }}
                  />
                  <Label htmlFor={`med-prohibited-${index}`} className="text-xs cursor-pointer">
                    麻薬/抗がん剤
                  </Label>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
