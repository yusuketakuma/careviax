'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { buildPatientHref } from '@/lib/patient/navigation';
import { createPatientSchema } from '@/lib/validations/patient';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useUnsavedChangesGuard } from '@/lib/hooks/use-unsaved-changes-guard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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

const genderLabel: Record<string, string> = {
  male: '男性',
  female: '女性',
  other: 'その他',
};

const documentChecklistItems = [
  { field: 'doc_physician_order', label: '指示書' },
  { field: 'doc_consent', label: '同意書' },
  { field: 'doc_health_insurance', label: '保険証（医療）' },
  { field: 'doc_care_insurance', label: '介護保険証' },
] as const satisfies ReadonlyArray<{ field: DocumentChecklistField; label: string }>;

// 単一の POST /api/referrals に送るペイロード。フォームの ReferralFormSubmit +
// バックエンド createReferralSchema とフィールドが 1:1 で対応する。
type ReferralPayload = {
  name: ReferralFormSubmit['name'];
  name_kana: ReferralFormSubmit['name_kana'];
  birth_date: ReferralFormSubmit['birth_date'];
  gender: ReferralFormSubmit['gender'];
  phone: ReferralFormSubmit['phone'];
  medical_insurance_number: ReferralFormSubmit['medical_insurance_number'];
  care_insurance_number: ReferralFormSubmit['care_insurance_number'];
  address: ReferralFormSubmit['address'];
  referral_type: ReferralFormSubmit['referral_type'];
  referral_source: ReferralFormSubmit['referral_source'];
  referral_date: ReferralFormSubmit['referral_date'];
  referral_notes: ReferralFormSubmit['referral_notes'];
  doc_physician_order: boolean;
  doc_consent: boolean;
  doc_health_insurance: boolean;
  doc_care_insurance: boolean;
};

// 重複確認後の再送ペイロード（duplicate_acknowledged を付与）。
type ReferralSubmitPayload = ReferralPayload & { duplicate_acknowledged?: boolean };

// /api/referrals の固定文言。バックエンドが返す既知のコピーのみ信頼し、
// それ以外は PHI 漏洩を避けるため固定フォールバックに倒す。
const REFERRAL_ERROR_FALLBACK = '紹介受付に失敗しました';
const TRUSTED_REFERRAL_ERROR_MESSAGES = new Set<string>([
  'リクエストボディが不正です',
  '入力値が不正です',
  '紹介受付の登録に失敗しました',
  'サーバー内部でエラーが発生しました',
]);

/**
 * PHI-safe なエラー文言を導出する。期待されるエンベロープの body.message が
 * 信頼できる固定コピーのときだけそれを使い、それ以外（自由記述・details・
 * 例外メッセージ）は固定フォールバックを返す。details は表示に一切使わない。
 */
function resolveReferralErrorMessage(body: unknown): string {
  if (body && typeof body === 'object' && 'message' in body) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === 'string' && TRUSTED_REFERRAL_ERROR_MESSAGES.has(message)) {
      return message;
    }
  }
  return REFERRAL_ERROR_FALLBACK;
}

export function ReferralForm() {
  const router = useRouter();
  const orgId = useOrgId();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  // 重複確認のための payload スナップショット。送信した EXACT なオブジェクトを
  // 保持し、確認時はこれをそのまま再送する（getValues は使わない）。
  const [pendingReferralPayload, setPendingReferralPayload] = useState<ReferralPayload | null>(
    null,
  );
  const [duplicateCount, setDuplicateCount] = useState(0);
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
    control,
    formState: { errors, isDirty },
  } = form;
  const allowNavigation = useUnsavedChangesGuard({
    enabled: isDirty,
  });
  const documentChecklistValues = useWatch({
    control: form.control,
    name: documentChecklistItems.map((item) => item.field),
  });

  // STALE-ACK SAFETY: 重複ダイアログが開いている間にフォームが変更されたら、
  // 取得済みの acknowledgement が変異した identity に適用されないよう即無効化する
  // （スナップショットを破棄しダイアログを閉じる）。
  useEffect(() => {
    const unsubscribe = form.subscribe({
      formState: { values: true },
      callback: () => {
        setPendingReferralPayload((current) => (current === null ? current : null));
      },
    });
    return () => unsubscribe();
  }, [form]);
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

  // 単一のアトミックな POST /api/referrals。ステータスごとに分岐し、201 で遷移、
  // 409 で count-only の重複ダイアログ、それ以外は PHI-safe なエラー文言に倒す。
  const submitReferral = useCallback(
    async (payload: ReferralSubmitPayload) => {
      setIsSubmitting(true);
      try {
        let res: Response;
        try {
          res = await fetch('/api/referrals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
            body: JSON.stringify(payload),
          });
        } catch {
          // ネットワーク失敗: 固定文言のみ。
          toast.error(REFERRAL_ERROR_FALLBACK);
          return;
        }

        if (res.ok) {
          let patient: { id: string } | undefined;
          try {
            const body = (await res.json()) as { patient?: { id?: unknown } };
            const id = body?.patient?.id;
            if (typeof id === 'string') patient = { id };
          } catch {
            // 2xx だが JSON パース失敗: fail-closed で固定文言、遷移しない。
            toast.error(REFERRAL_ERROR_FALLBACK);
            return;
          }
          if (!patient) {
            toast.error(REFERRAL_ERROR_FALLBACK);
            return;
          }
          toast.success('紹介受付が完了しました');
          allowNavigation();
          router.push(buildPatientHref(patient.id));
          return;
        }

        if (res.status === 409) {
          // duplicate_count のみを取り出す。duplicates(dup id) は即破棄し、
          // 保存・描画・ログ・toast のいずれにも載せない。
          let count = 0;
          try {
            const body = (await res.json()) as {
              details?: { duplicate_count?: unknown };
            };
            count = Number(body?.details?.duplicate_count ?? 0);
            if (!Number.isFinite(count)) count = 0;
          } catch {
            count = 0;
          }
          setPendingReferralPayload(payload);
          setDuplicateCount(count);
          return;
        }

        // 400/500/その他: PHI-safe なエラー文言。details は表示に使わない。
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          body = null;
        }
        toast.error(resolveReferralErrorMessage(body));
      } finally {
        setIsSubmitting(false);
      }
    },
    [orgId, allowNavigation, router],
  );

  function buildReferralPayload(data: ReferralFormSubmit): ReferralPayload {
    return {
      name: data.name,
      name_kana: data.name_kana,
      birth_date: data.birth_date,
      gender: data.gender,
      phone: data.phone,
      medical_insurance_number: data.medical_insurance_number,
      care_insurance_number: data.care_insurance_number,
      address: data.address,
      referral_type: data.referral_type,
      referral_source: data.referral_source,
      referral_date: data.referral_date,
      referral_notes: data.referral_notes,
      doc_physician_order: data.doc_physician_order,
      doc_consent: data.doc_consent,
      doc_health_insurance: data.doc_health_insurance,
      doc_care_insurance: data.doc_care_insurance,
    };
  }

  async function onSubmit(data: ReferralFormSubmit) {
    await submitReferral(buildReferralPayload(data));
  }

  return (
    <form onSubmit={handleSubmit(onSubmit, scrollToErrorSummary)} noValidate className="space-y-6">
      <ConfirmDialog
        open={showDiscardConfirm}
        onOpenChange={setShowDiscardConfirm}
        title="入力内容を破棄しますか？"
        description="未保存の入力内容は破棄されます。よろしいですか？"
        variant="destructive"
        confirmLabel="破棄して戻る"
        cancelLabel="編集を続ける"
        onConfirm={() => {
          allowNavigation();
          router.back();
        }}
      />

      <ConfirmDialog
        open={pendingReferralPayload !== null}
        onOpenChange={(open) => {
          if (!open) setPendingReferralPayload(null);
        }}
        title="重複の可能性がある患者があります"
        description={
          '重複の可能性がある患者が ' +
          duplicateCount +
          ' 件 あります。候補の詳細はここには表示されません。このまま続けると新規の紹介患者・ケースを作成します（既存への統合ではありません）。'
        }
        variant="default"
        confirmLabel="新規作成して続ける"
        cancelLabel="戻って確認"
        confirmDisabled={isSubmitting}
        onConfirm={() => {
          if (!pendingReferralPayload) return;
          const payload = { ...pendingReferralPayload, duplicate_acknowledged: true };
          setPendingReferralPayload(null);
          void submitReferral(payload);
        }}
      />

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
          <Controller
            control={control}
            name="referral_type"
            render={({ field }) => (
              <Select value={field.value ?? ''} onValueChange={field.onChange}>
                <SelectTrigger
                  id="referral_type"
                  aria-invalid={!!errors.referral_type}
                  aria-describedby={errors.referral_type ? 'referral-type-error' : undefined}
                  className="min-h-[44px] w-full sm:min-h-[44px]"
                >
                  <SelectValue>
                    {field.value ? referralTypeLabel[field.value] : '選択してください'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="" className="min-h-[44px]">
                    選択してください
                  </SelectItem>
                  {Object.entries(referralTypeLabel).map(([value, label]) => (
                    <SelectItem key={value} value={value} className="min-h-[44px]">
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
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
                onCheckedChange={(checked) =>
                  setValue(field, checked === true, { shouldDirty: true, shouldTouch: true })
                }
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
            <Controller
              control={control}
              name="gender"
              render={({ field }) => (
                <Select value={field.value ?? ''} onValueChange={field.onChange}>
                  <SelectTrigger
                    id="ref-gender"
                    aria-invalid={!!errors.gender}
                    aria-describedby={errors.gender ? 'ref-gender-error' : undefined}
                    className="min-h-[44px] w-full sm:min-h-[44px]"
                  >
                    <SelectValue>
                      {field.value ? genderLabel[field.value] : '選択してください'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="" className="min-h-[44px]">
                      選択してください
                    </SelectItem>
                    {Object.entries(genderLabel).map(([value, label]) => (
                      <SelectItem key={value} value={value} className="min-h-[44px]">
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
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
          onClick={() => {
            if (isDirty) {
              setShowDiscardConfirm(true);
            } else {
              router.back();
            }
          }}
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
