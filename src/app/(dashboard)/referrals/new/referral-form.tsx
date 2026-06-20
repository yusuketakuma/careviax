'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { createPatientSchema } from '@/lib/validations/patient';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { FormErrorSummary } from '@/components/ui/form-error-summary';
import { LoadingButton } from '@/components/ui/loading-button';
import { PageSection } from '@/components/layout/page-section';
import { ActionRail } from '@/components/ui/action-rail';
import { collectFormErrorSummaryItems } from '@/lib/forms/errors';
import { dateKeySchema } from '@/lib/validations/date-key';

const referralFormSchema = z
  .object({
    // Referral-specific fields
    referral_type: z.enum(['physician', 'care_manager', 'facility', 'family'], {
      error: '依頼種別を選択してください',
    }),
    referral_source: z.string().optional(),
    referral_date: dateKeySchema('日付形式が不正です')
      .optional()
      .or(z.literal(''))
      .transform((v) => (v === '' ? undefined : v)),
    referral_notes: z.string().optional(),
    // Documents checklist
    doc_physician_order: z.boolean(),
    doc_consent: z.boolean(),
    doc_health_insurance: z.boolean(),
    doc_care_insurance: z.boolean(),
    // Patient fields (from createPatientSchema)
  })
  .merge(createPatientSchema);

type ReferralFormValues = z.input<typeof referralFormSchema>;
type ReferralFormSubmit = z.output<typeof referralFormSchema>;
type DocumentChecklistField =
  | 'doc_physician_order'
  | 'doc_consent'
  | 'doc_health_insurance'
  | 'doc_care_insurance';

const referralTypeLabel: Record<string, string> = {
  physician: '医師指示書',
  care_manager: 'ケアマネ依頼',
  facility: '施設依頼',
  family: '家族相談',
};

const documentChecklistItems = [
  { field: 'doc_physician_order', label: '指示書' },
  { field: 'doc_consent', label: '同意書' },
  { field: 'doc_health_insurance', label: '保険証（医療）' },
  { field: 'doc_care_insurance', label: '介護保険証' },
] as const satisfies ReadonlyArray<{ field: DocumentChecklistField; label: string }>;

export function ReferralForm() {
  const router = useRouter();
  const orgId = useOrgId();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const errorSummaryId = 'referral-form-error-summary';

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
    setValue,
    formState: { errors },
  } = form;
  const documentChecklistValues = useWatch({
    control: form.control,
    name: documentChecklistItems.map((item) => item.field),
  });
  const errorSummaryItems = collectFormErrorSummaryItems(errors, {
    referral_type: '依頼種別',
    referral_date: '紹介日',
    name: '氏名',
    name_kana: 'フリガナ',
    birth_date: '生年月日',
    gender: '性別',
  });

  const scrollToErrorSummary = useCallback(() => {
    if (typeof document === 'undefined') return;
    window.requestAnimationFrame(() => {
      const summary = document.getElementById(errorSummaryId);
      summary?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      summary?.focus();
    });
  }, [errorSummaryId]);

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
    <form onSubmit={handleSubmit(onSubmit, scrollToErrorSummary)} noValidate className="space-y-6">
      <FormErrorSummary id={errorSummaryId} items={errorSummaryItems} />

      <PageSection
        title="依頼元情報"
        description="紹介元、紹介日、受付時の補足を先に確認します。"
        contentClassName="space-y-4"
      >
        <div className="space-y-1.5">
          <Label htmlFor="referral_type">
            依頼種別{' '}
            <span className="text-destructive" aria-hidden="true">
              *
            </span>
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
              <option key={value} value={value}>
                {label}
              </option>
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
            <Input id="referral_date" type="date" {...register('referral_date')} />
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
      </PageSection>

      <PageSection
        title="必要書類チェックリスト"
        description="受付時点で受領済みの書類を確認します。"
      >
        <div className="space-y-3">
          {documentChecklistItems.map(({ field, label }, index) => (
            <div key={field} className="flex items-center gap-3">
              <Checkbox
                id={field}
                checked={documentChecklistValues[index] === true}
                onCheckedChange={(checked) => setValue(field, checked === true)}
                aria-label={`${label}を受領済み`}
              />
              <Label htmlFor={field} className="cursor-pointer font-normal">
                {label}
              </Label>
            </div>
          ))}
        </div>
      </PageSection>

      <PageSection
        title="患者基本情報"
        description="患者登録とケース作成に使う基本情報を入力します。"
        contentClassName="space-y-4"
      >
        <div className="space-y-1.5">
          <Label htmlFor="ref-name">
            氏名{' '}
            <span className="text-destructive" aria-hidden="true">
              *
            </span>
          </Label>
          <Input
            id="ref-name"
            {...register('name')}
            placeholder="山田 太郎"
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? 'ref-name-error' : undefined}
          />
          {errors.name && (
            <p id="ref-name-error" className="text-xs text-destructive" role="alert">
              {errors.name.message}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ref-name-kana">
            フリガナ{' '}
            <span className="text-destructive" aria-hidden="true">
              *
            </span>
          </Label>
          <Input
            id="ref-name-kana"
            {...register('name_kana')}
            placeholder="ヤマダ タロウ"
            aria-invalid={!!errors.name_kana}
            aria-describedby={errors.name_kana ? 'ref-name-kana-error' : undefined}
          />
          {errors.name_kana && (
            <p id="ref-name-kana-error" className="text-xs text-destructive" role="alert">
              {errors.name_kana.message}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ref-birth-date">
              生年月日{' '}
              <span className="text-destructive" aria-hidden="true">
                *
              </span>
            </Label>
            <Input
              id="ref-birth-date"
              type="date"
              {...register('birth_date')}
              aria-invalid={!!errors.birth_date}
              aria-describedby={errors.birth_date ? 'ref-birth-date-error' : undefined}
            />
            {errors.birth_date && (
              <p id="ref-birth-date-error" className="text-xs text-destructive" role="alert">
                {errors.birth_date.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ref-gender">
              性別{' '}
              <span className="text-destructive" aria-hidden="true">
                *
              </span>
            </Label>
            <select
              id="ref-gender"
              {...register('gender')}
              aria-invalid={!!errors.gender}
              aria-describedby={errors.gender ? 'ref-gender-error' : undefined}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive"
            >
              <option value="">選択してください</option>
              <option value="male">男性</option>
              <option value="female">女性</option>
              <option value="other">その他</option>
            </select>
            {errors.gender && (
              <p id="ref-gender-error" className="text-xs text-destructive" role="alert">
                {errors.gender.message}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ref-phone">電話番号</Label>
          <Input id="ref-phone" type="tel" {...register('phone')} placeholder="090-0000-0000" />
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
      </PageSection>

      <ActionRail>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isSubmitting}
        >
          キャンセル
        </Button>
        <LoadingButton type="submit" loading={isSubmitting} loadingLabel="受付中...">
          紹介受付を完了する
        </LoadingButton>
      </ActionRail>
    </form>
  );
}
