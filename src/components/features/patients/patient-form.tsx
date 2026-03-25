'use client';

import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { createPatientSchema, type CreatePatientInput } from '@/lib/validations/patient';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface PatientFormProps {
  /** Where to redirect after successful submission */
  redirectTo?: string;
  /** Called with the created patient id, in addition to redirect */
  onSuccess?: (patientId: string) => void;
  /** Initial values (for embedded use in referral form) */
  defaultValues?: Partial<CreatePatientInput>;
}

export function PatientForm({ redirectTo, onSuccess, defaultValues }: PatientFormProps) {
  const router = useRouter();
  const orgId = useOrgId();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreatePatientInput>({
    resolver: zodResolver(createPatientSchema),
    defaultValues: defaultValues ?? {},
  });

  async function onSubmit(data: CreatePatientInput) {
    const res = await fetch('/api/patients', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-org-id': orgId,
      },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.message ?? '登録に失敗しました');
      return;
    }

    const patient = await res.json();
    toast.success('患者を登録しました');
    onSuccess?.(patient.id);
    if (redirectTo) {
      router.push(redirectTo);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">基本情報</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 氏名 */}
          <div className="space-y-1.5">
            <Label htmlFor="name">
              氏名 <span className="text-destructive" aria-hidden="true">*</span>
            </Label>
            <Input
              id="name"
              {...register('name')}
              placeholder="山田 太郎"
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? 'name-error' : undefined}
            />
            {errors.name && (
              <p id="name-error" className="text-xs text-destructive" role="alert">
                {errors.name.message}
              </p>
            )}
          </div>

          {/* フリガナ */}
          <div className="space-y-1.5">
            <Label htmlFor="name_kana">
              フリガナ <span className="text-destructive" aria-hidden="true">*</span>
            </Label>
            <Input
              id="name_kana"
              {...register('name_kana')}
              placeholder="ヤマダ タロウ"
              aria-invalid={!!errors.name_kana}
              aria-describedby={errors.name_kana ? 'name-kana-error' : undefined}
            />
            {errors.name_kana && (
              <p id="name-kana-error" className="text-xs text-destructive" role="alert">
                {errors.name_kana.message}
              </p>
            )}
          </div>

          {/* 生年月日 + 性別 */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="birth_date">
                生年月日 <span className="text-destructive" aria-hidden="true">*</span>
              </Label>
              <Input
                id="birth_date"
                type="date"
                {...register('birth_date')}
                aria-invalid={!!errors.birth_date}
                aria-describedby={errors.birth_date ? 'birth-date-error' : undefined}
              />
              {errors.birth_date && (
                <p id="birth-date-error" className="text-xs text-destructive" role="alert">
                  {errors.birth_date.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="gender">
                性別 <span className="text-destructive" aria-hidden="true">*</span>
              </Label>
              <select
                id="gender"
                {...register('gender')}
                aria-invalid={!!errors.gender}
                aria-describedby={errors.gender ? 'gender-error' : undefined}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive"
              >
                <option value="">選択してください</option>
                <option value="male">男性</option>
                <option value="female">女性</option>
                <option value="other">その他</option>
              </select>
              {errors.gender && (
                <p id="gender-error" className="text-xs text-destructive" role="alert">
                  {errors.gender.message}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">連絡先・保険情報</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 電話番号 */}
          <div className="space-y-1.5">
            <Label htmlFor="phone">電話番号</Label>
            <Input
              id="phone"
              type="tel"
              {...register('phone')}
              placeholder="090-0000-0000"
            />
          </div>

          {/* 住所 */}
          <div className="space-y-1.5">
            <Label htmlFor="address">住所</Label>
            <Textarea
              id="address"
              {...register('address')}
              placeholder="東京都新宿区..."
              rows={2}
            />
          </div>

          {/* 医療保険番号 */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="medical_insurance_number">医療保険番号</Label>
              <Input
                id="medical_insurance_number"
                {...register('medical_insurance_number')}
                placeholder="12345678"
              />
            </div>

            {/* 介護保険番号 */}
            <div className="space-y-1.5">
              <Label htmlFor="care_insurance_number">介護保険番号</Label>
              <Input
                id="care_insurance_number"
                {...register('care_insurance_number')}
                placeholder="1234567890"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isSubmitting}
        >
          キャンセル
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? '登録中...' : '登録する'}
        </Button>
      </div>
    </form>
  );
}
