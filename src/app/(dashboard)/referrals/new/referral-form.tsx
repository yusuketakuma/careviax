'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { createPatientSchema } from '@/lib/validations/patient';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';

const referralFormSchema = z.object({
  // Referral-specific fields
  referral_type: z.enum(['physician', 'care_manager', 'facility', 'family'], {
    error: '依頼種別を選択してください',
  }),
  referral_source: z.string().optional(),
  referral_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です').optional().or(z.literal('')).transform(v => v === '' ? undefined : v),
  referral_notes: z.string().optional(),
  // Documents checklist
  doc_physician_order: z.boolean(),
  doc_consent: z.boolean(),
  doc_health_insurance: z.boolean(),
  doc_care_insurance: z.boolean(),
  // Patient fields (from createPatientSchema)
}).merge(createPatientSchema);

type ReferralFormValues = z.input<typeof referralFormSchema>;
type ReferralFormSubmit = z.output<typeof referralFormSchema>;

const referralTypeLabel: Record<string, string> = {
  physician: '医師指示書',
  care_manager: 'ケアマネ依頼',
  facility: '施設依頼',
  family: '家族相談',
};

export function ReferralForm() {
  const router = useRouter();
  const orgId = useOrgId();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<ReferralFormValues, unknown, ReferralFormSubmit>({
    resolver: zodResolver(referralFormSchema),
    defaultValues: {
      doc_physician_order: false,
      doc_consent: false,
      doc_health_insurance: false,
      doc_care_insurance: false,
    },
  });
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = form;
  async function onSubmit(data: ReferralFormSubmit) {
    setIsSubmitting(true);
    try {
      // 1. Create patient
      const patientRes = await fetch('/api/patients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({
          name: data.name,
          name_kana: data.name_kana,
          birth_date: data.birth_date,
          gender: data.gender,
          phone: data.phone,
          medical_insurance_number: data.medical_insurance_number,
          care_insurance_number: data.care_insurance_number,
          address: data.address,
        }),
      });

      if (!patientRes.ok) {
        const err = await patientRes.json().catch(() => ({}));
        toast.error(err.message ?? '患者登録に失敗しました');
        return;
      }

      const patient = await patientRes.json();

      // 2. Create case
      const caseRes = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({
          patient_id: patient.id,
          referral_source: data.referral_source,
          referral_date: data.referral_date,
          notes: data.referral_notes,
        }),
      });

      if (!caseRes.ok) {
        const err = await caseRes.json().catch(() => ({}));
        toast.error(err.message ?? 'ケース作成に失敗しました');
        return;
      }

      toast.success('紹介受付が完了しました');
      router.push(`/patients/${patient.id}`);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
      {/* 依頼元情報 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">依頼元情報</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="referral_type">
              依頼種別 <span className="text-destructive" aria-hidden="true">*</span>
            </Label>
            <select
              id="referral_type"
              {...register('referral_type')}
              aria-invalid={!!errors.referral_type}
              aria-describedby={errors.referral_type ? 'referral-type-error' : undefined}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive"
            >
              <option value="">選択してください</option>
              {Object.entries(referralTypeLabel).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            {errors.referral_type && (
              <p id="referral-type-error" className="text-xs text-destructive" role="alert">
                {errors.referral_type.message}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="referral_source">依頼元名称</Label>
              <Input
                id="referral_source"
                {...register('referral_source')}
                placeholder="〇〇クリニック"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="referral_date">紹介日</Label>
              <Input
                id="referral_date"
                type="date"
                {...register('referral_date')}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="referral_notes">備考</Label>
            <Textarea
              id="referral_notes"
              {...register('referral_notes')}
              placeholder="特記事項があれば入力してください"
              rows={2}
            />
          </div>
        </CardContent>
      </Card>

      {/* 必要書類チェックリスト */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">必要書類チェックリスト</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {(
              [
                { field: 'doc_physician_order' as const, label: '指示書' },
                { field: 'doc_consent' as const, label: '同意書' },
                { field: 'doc_health_insurance' as const, label: '保険証（医療）' },
                { field: 'doc_care_insurance' as const, label: '介護保険証' },
              ] as const
            ).map(({ field, label }) => (
              <div key={field} className="flex items-center gap-3">
                <Checkbox
                  id={field}
                  checked={watch(field)}
                  onCheckedChange={(checked) => setValue(field, checked === true)}
                  aria-label={`${label}を受領済み`}
                />
                <Label htmlFor={field} className="cursor-pointer font-normal">
                  {label}
                </Label>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 患者基本情報 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">患者基本情報</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ref-name">
              氏名 <span className="text-destructive" aria-hidden="true">*</span>
            </Label>
            <Input
              id="ref-name"
              {...register('name')}
              placeholder="山田 太郎"
              aria-invalid={!!errors.name}
            />
            {errors.name && (
              <p className="text-xs text-destructive" role="alert">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ref-name-kana">
              フリガナ <span className="text-destructive" aria-hidden="true">*</span>
            </Label>
            <Input
              id="ref-name-kana"
              {...register('name_kana')}
              placeholder="ヤマダ タロウ"
              aria-invalid={!!errors.name_kana}
            />
            {errors.name_kana && (
              <p className="text-xs text-destructive" role="alert">{errors.name_kana.message}</p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ref-birth-date">
                生年月日 <span className="text-destructive" aria-hidden="true">*</span>
              </Label>
              <Input
                id="ref-birth-date"
                type="date"
                {...register('birth_date')}
                aria-invalid={!!errors.birth_date}
              />
              {errors.birth_date && (
                <p className="text-xs text-destructive" role="alert">{errors.birth_date.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ref-gender">
                性別 <span className="text-destructive" aria-hidden="true">*</span>
              </Label>
              <select
                id="ref-gender"
                {...register('gender')}
                aria-invalid={!!errors.gender}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive"
              >
                <option value="">選択してください</option>
                <option value="male">男性</option>
                <option value="female">女性</option>
                <option value="other">その他</option>
              </select>
              {errors.gender && (
                <p className="text-xs text-destructive" role="alert">{errors.gender.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ref-phone">電話番号</Label>
            <Input
              id="ref-phone"
              type="tel"
              {...register('phone')}
              placeholder="090-0000-0000"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ref-address">住所</Label>
            <Textarea
              id="ref-address"
              {...register('address')}
              placeholder="東京都新宿区..."
              rows={2}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ref-medical-ins">医療保険番号</Label>
              <Input
                id="ref-medical-ins"
                {...register('medical_insurance_number')}
                placeholder="12345678"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ref-care-ins">介護保険番号</Label>
              <Input
                id="ref-care-ins"
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
          {isSubmitting ? '受付中...' : '紹介受付を完了する'}
        </Button>
      </div>
    </form>
  );
}
