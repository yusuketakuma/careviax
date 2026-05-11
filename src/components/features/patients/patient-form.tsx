'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { createPatientSchema, type CreatePatientInput } from '@/lib/validations/patient';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormErrorSummary } from '@/components/ui/form-error-summary';
import { LoadingButton } from '@/components/ui/loading-button';
import { collectFormErrorSummaryItems } from '@/lib/forms/errors';
import {
  adlLabels,
  careLevelLabels,
  contactMethodLabels,
  dementiaLabels,
  firstVisitSlotLabels,
  housingTypeLabels,
  medicationSupportLabels,
  moneyManagementLabels,
  requesterProfessionLabels,
  specialProcedureLabels,
} from '@/lib/patient/home-visit-intake';
import { evaluateServiceAreaWarning, type ServiceAreaRecord } from '@/lib/patient/service-area';

interface DuplicatePatient {
  id: string;
  name: string;
  name_kana: string | null;
  birth_date: string;
  gender: string;
}

type FacilityOption = {
  id: string;
  name: string;
  address: string | null;
};

type FacilityUnitOption = {
  id: string;
  name: string;
  floor: string | null;
  unit_type: string | null;
};

type ServiceAreaOption = ServiceAreaRecord & {
  site: {
    id: string;
    name: string;
  } | null;
};

interface PatientFormProps {
  /** When provided, submits an update instead of a create */
  patientId?: string;
  /** Where to redirect after successful submission */
  redirectTo?: string;
  /** Called with the created patient id, in addition to redirect */
  onSuccess?: (patientId: string) => void;
  /** Initial values (for embedded use in referral form) */
  defaultValues?: Partial<CreatePatientInput>;
}

const optionalBooleanFieldOptions = {
  setValueAs: (value: string) => {
    if (value === '') return undefined;
    return value === 'true';
  },
};

const optionalNumberFieldOptions = {
  setValueAs: (value: string) => {
    if (value === '') return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  },
};

const optionalTextFieldOptions = {
  setValueAs: (value: string) => (value === '' ? undefined : value),
};

function formatOptionLabelMap(labelMap: Record<string, string>) {
  return Object.entries(labelMap).map(([value, label]) => ({ value, label }));
}

const requesterProfessionOptions = formatOptionLabelMap(requesterProfessionLabels);
const contactMethodOptions = formatOptionLabelMap(contactMethodLabels);
const housingTypeOptions = formatOptionLabelMap(housingTypeLabels);
const firstVisitSlotOptions = formatOptionLabelMap(firstVisitSlotLabels);
const careLevelOptions = formatOptionLabelMap(careLevelLabels);
const adlOptions = formatOptionLabelMap(adlLabels);
const dementiaOptions = formatOptionLabelMap(dementiaLabels);
const moneyManagementOptions = formatOptionLabelMap(moneyManagementLabels);
const medicationSupportOptions = formatOptionLabelMap(medicationSupportLabels);
const specialProcedureOptions = formatOptionLabelMap(specialProcedureLabels);

export function PatientForm({ patientId, redirectTo, onSuccess, defaultValues }: PatientFormProps) {
  const router = useRouter();
  const orgId = useOrgId();
  const [duplicates, setDuplicates] = useState<DuplicatePatient[]>([]);
  const [duplicateConfirmedKey, setDuplicateConfirmedKey] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAutofilledAddressRef = useRef<string | null>(null);
  const errorSummaryId = 'patient-form-error-summary';

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreatePatientInput>({
    resolver: zodResolver(createPatientSchema),
    defaultValues: defaultValues ?? {},
  });

  const [watchedName, watchedBirthDate, watchedGender] = useWatch({
    control,
    name: ['name', 'birth_date', 'gender'],
  });
  const selectedFacilityId =
    useWatch({
      control,
      name: 'facility_id',
    }) ?? '';
  const watchedAddress =
    useWatch({
      control,
      name: 'address',
    }) ?? '';
  const watchedMedicationSupportMethods =
    useWatch({
      control,
      name: 'intake.medication_support_methods',
    }) ?? [];
  const watchedSpecialProcedures =
    useWatch({
      control,
      name: 'intake.special_medical_procedures',
    }) ?? [];
  const watchedBillingSupportFlag =
    useWatch({
      control,
      name: 'billing_support_flag',
    }) ?? false;
  const previousFacilityIdRef = useRef<string>('');
  const duplicateLookupKey =
    !patientId && watchedName?.trim() && watchedBirthDate && watchedGender
      ? `${watchedName.trim()}::${watchedBirthDate}::${watchedGender}`
      : null;
  const duplicateConfirmed =
    duplicateLookupKey !== null && duplicateConfirmedKey === duplicateLookupKey;
  const activeDuplicates = duplicateLookupKey ? duplicates : [];
  const errorSummaryItems = collectFormErrorSummaryItems(errors, {
    name: '氏名',
    name_kana: 'フリガナ',
    birth_date: '生年月日',
    gender: '性別',
    address: '住所',
  });
  const errorSummaryTitle =
    errorSummaryItems.length > 0
      ? `必須の${errorSummaryItems.length}項目を入力してください`
      : '必須項目を確認してください';

  const scrollToErrorSummary = useCallback(() => {
    if (typeof document === 'undefined') return;
    window.requestAnimationFrame(() => {
      const summary = document.getElementById(errorSummaryId);
      summary?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      summary?.focus();
    });
  }, [errorSummaryId]);

  const toggleStringArrayField = useCallback(
    (
      field: 'intake.medication_support_methods' | 'intake.special_medical_procedures',
      currentValues: string[],
      value: string,
      checked: boolean,
    ) => {
      const nextValues = checked
        ? Array.from(new Set([...currentValues, value]))
        : currentValues.filter((item) => item !== value);
      setValue(field, nextValues, { shouldDirty: true });
    },
    [setValue],
  );

  const checkDuplicate = useCallback(
    async (name: string, birthDate: string, gender: string) => {
      try {
        const params = new URLSearchParams({ name, date_of_birth: birthDate, gender });
        const res = await fetch(`/api/patients/check-duplicate?${params}`, {
          headers: { 'x-org-id': orgId },
        });
        if (res.ok) {
          const data = await res.json();
          setDuplicates(data.duplicates ?? []);
        }
      } catch {
        // Silently ignore duplicate check errors
      }
    },
    [orgId],
  );

  const facilitiesQuery = useQuery({
    queryKey: ['patient-form', 'facilities', orgId],
    queryFn: async () => {
      const res = await fetch('/api/admin/facilities', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) {
        throw new Error('施設一覧の取得に失敗しました');
      }
      const payload = (await res.json()) as { data?: FacilityOption[] };
      return payload.data ?? [];
    },
    enabled: !!orgId,
  });

  const facilityUnitsQuery = useQuery({
    queryKey: ['patient-form', 'facility-units', orgId, selectedFacilityId],
    queryFn: async () => {
      const res = await fetch(`/api/admin/facilities/${selectedFacilityId}/units`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) {
        throw new Error('ユニット一覧の取得に失敗しました');
      }
      const payload = (await res.json()) as { data?: FacilityUnitOption[] };
      return payload.data ?? [];
    },
    enabled: !!orgId && !!selectedFacilityId,
  });

  const serviceAreasQuery = useQuery({
    queryKey: ['patient-form', 'service-areas', orgId],
    queryFn: async () => {
      const res = await fetch('/api/service-areas', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) {
        throw new Error('訪問エリア設定の取得に失敗しました');
      }
      const payload = (await res.json()) as { data?: ServiceAreaOption[] };
      return payload.data ?? [];
    },
    enabled: !!orgId,
  });

  const serviceAreaWarning = evaluateServiceAreaWarning({
    serviceAreas: serviceAreasQuery.data ?? [],
    address: watchedAddress,
    facilityId: selectedFacilityId || null,
  });

  useEffect(() => {
    if (patientId) return;
    if (!watchedName?.trim() || !watchedBirthDate || !watchedGender) {
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      checkDuplicate(watchedName.trim(), watchedBirthDate, watchedGender);
    }, 500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [patientId, watchedName, watchedBirthDate, watchedGender, checkDuplicate]);

  useEffect(() => {
    const previousFacilityId = previousFacilityIdRef.current;
    if (previousFacilityId && previousFacilityId !== selectedFacilityId) {
      setValue('facility_unit_id', '');
      if (
        !selectedFacilityId &&
        watchedAddress &&
        watchedAddress === lastAutofilledAddressRef.current
      ) {
        setValue('address', '', { shouldDirty: true });
        lastAutofilledAddressRef.current = null;
      }
    }
    previousFacilityIdRef.current = selectedFacilityId;
  }, [selectedFacilityId, setValue, watchedAddress]);

  useEffect(() => {
    if (!selectedFacilityId) {
      setValue('facility_unit_id', '');
    }
  }, [selectedFacilityId, setValue]);

  useEffect(() => {
    if (!selectedFacilityId) return;

    const selectedFacility =
      (facilitiesQuery.data ?? []).find((facility) => facility.id === selectedFacilityId) ?? null;
    if (!selectedFacility?.address) return;
    if (watchedAddress && watchedAddress !== lastAutofilledAddressRef.current) return;
    if (watchedAddress === selectedFacility.address) {
      lastAutofilledAddressRef.current = selectedFacility.address;
      return;
    }

    setValue('address', selectedFacility.address, {
      shouldDirty: true,
    });
    lastAutofilledAddressRef.current = selectedFacility.address;
  }, [facilitiesQuery.data, selectedFacilityId, setValue, watchedAddress]);

  async function onSubmit(data: CreatePatientInput) {
    const res = await fetch(patientId ? `/api/patients/${patientId}` : '/api/patients', {
      method: patientId ? 'PATCH' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-org-id': orgId,
      },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.message ?? (patientId ? '更新に失敗しました' : '登録に失敗しました'));
      return;
    }

    const patient = await res.json();
    toast.success(patientId ? '患者情報を更新しました' : '患者を登録しました');
    onSuccess?.(patient.id ?? patientId);
    if (redirectTo) {
      router.push(redirectTo);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit, scrollToErrorSummary)} noValidate className="space-y-6">
      <FormErrorSummary
        id={errorSummaryId}
        title={errorSummaryTitle}
        items={errorSummaryItems}
        showMessage={false}
        compact
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">基本情報</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 氏名 */}
          <div className="space-y-1.5">
            <Label htmlFor="name">
              氏名{' '}
              <span className="text-destructive" aria-hidden="true">
                *
              </span>
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
              フリガナ{' '}
              <span className="text-destructive" aria-hidden="true">
                *
              </span>
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
                生年月日{' '}
                <span className="text-destructive" aria-hidden="true">
                  *
                </span>
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
                性別{' '}
                <span className="text-destructive" aria-hidden="true">
                  *
                </span>
              </Label>
              <select
                id="gender"
                {...register('gender')}
                aria-invalid={!!errors.gender}
                aria-describedby={errors.gender ? 'gender-error' : undefined}
                className="min-h-[44px] w-full rounded-lg border sm:h-8 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive"
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
            <Input id="phone" type="tel" {...register('phone')} placeholder="090-0000-0000" />
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

          {serviceAreaWarning ? (
            <Alert
              variant="default"
              className={
                serviceAreaWarning.level === 'covered'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : 'border-amber-300 bg-amber-50 text-amber-900'
              }
            >
              <AlertTriangle
                className={
                  serviceAreaWarning.level === 'covered'
                    ? 'h-4 w-4 text-emerald-600'
                    : 'h-4 w-4 text-amber-600'
                }
              />
              <AlertDescription>{serviceAreaWarning.message}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="facility_id">施設</Label>
              <select
                id="facility_id"
                {...register('facility_id')}
                className="min-h-[44px] w-full rounded-lg border sm:h-9 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
              >
                <option value="">居宅 / 未設定</option>
                {(facilitiesQuery.data ?? []).map((facility) => (
                  <option key={facility.id} value={facility.id}>
                    {facility.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                施設患者の場合は先に施設を選択してください。
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="facility_unit_id">ユニット</Label>
              <select
                id="facility_unit_id"
                {...register('facility_unit_id')}
                disabled={!selectedFacilityId || facilityUnitsQuery.isLoading}
                className="min-h-[44px] w-full rounded-lg border sm:h-9 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">
                  {!selectedFacilityId
                    ? '施設を選択してください'
                    : facilityUnitsQuery.isLoading
                      ? 'ユニットを読み込み中...'
                      : 'ユニットを選択してください'}
                </option>
                {(facilityUnitsQuery.data ?? []).map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {[unit.floor, unit.name].filter(Boolean).join(' / ')}
                  </option>
                ))}
              </select>
              {selectedFacilityId &&
                !facilityUnitsQuery.isLoading &&
                (facilityUnitsQuery.data?.length ?? 0) === 0 && (
                  <p className="text-xs text-amber-700" role="status">
                    この施設には登録済みユニットがありません。施設管理から先にユニットを追加してください。
                  </p>
                )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="unit_name">居室・部屋番号</Label>
            <Input
              id="unit_name"
              {...register('unit_name')}
              placeholder={
                selectedFacilityId ? '203号室 / 東棟3F など' : '居宅なら未入力で構いません'
              }
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

          <div className="space-y-1.5">
            <Label htmlFor="billing_support_flag">請求支援フラグ</Label>
            <label className="flex min-h-10 items-center gap-3 rounded-lg border border-border/70 px-3 py-2 text-sm">
              <Checkbox
                id="billing_support_flag"
                checked={watchedBillingSupportFlag}
                onCheckedChange={(checked) =>
                  setValue('billing_support_flag', checked === true, { shouldDirty: true })
                }
              />
              <span>請求支援が必要な患者として登録する</span>
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">紹介受付・依頼元</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="requester.organization_name">依頼元事業所</Label>
              <Input
                id="requester.organization_name"
                {...register('requester.organization_name')}
                placeholder="千代田クリニック"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="requester.profession">依頼元職種</Label>
              <select
                id="requester.profession"
                {...register('requester.profession')}
                className="min-h-[44px] w-full rounded-lg border sm:h-9 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <option value="">未設定</option>
                {requesterProfessionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="requester.contact_name">依頼元担当者</Label>
              <Input
                id="requester.contact_name"
                {...register('requester.contact_name')}
                placeholder="連携 太郎"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="requester.contact_name_kana">依頼元担当者フリガナ</Label>
              <Input
                id="requester.contact_name_kana"
                {...register('requester.contact_name_kana')}
                placeholder="レンケイ タロウ"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="requester.phone">依頼元電話番号</Label>
              <Input
                id="requester.phone"
                type="tel"
                {...register('requester.phone')}
                placeholder="03-1111-2222"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="requester.fax">依頼元FAX</Label>
              <Input id="requester.fax" {...register('requester.fax')} placeholder="03-1111-3333" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="requester.pharmacy_decision_due_date">薬局決定希望期限</Label>
              <Input
                id="requester.pharmacy_decision_due_date"
                type="date"
                {...register('requester.pharmacy_decision_due_date', optionalTextFieldOptions)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="requester.preferred_contact_method">依頼元優先連絡手段</Label>
              <select
                id="requester.preferred_contact_method"
                {...register('requester.preferred_contact_method')}
                className="min-h-[44px] w-full rounded-lg border sm:h-9 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <option value="">未設定</option>
                {contactMethodOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="requester.preferred_contact_method_other">連絡手段補足</Label>
            <Input
              id="requester.preferred_contact_method_other"
              {...register('requester.preferred_contact_method_other')}
              placeholder="MCSグループ / 午後に連絡希望 など"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">訪問初期情報</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="intake.age">受付時年齢</Label>
              <Input
                id="intake.age"
                type="number"
                min={0}
                max={150}
                {...register('intake.age', optionalNumberFieldOptions)}
                placeholder="82"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="intake.primary_disease">主病名</Label>
              <Input
                id="intake.primary_disease"
                {...register('intake.primary_disease')}
                placeholder="慢性心不全"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="intake.postal_code">郵便番号</Label>
              <Input
                id="intake.postal_code"
                {...register('intake.postal_code')}
                placeholder="100-0001"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="intake.housing_type">住居形態</Label>
              <select
                id="intake.housing_type"
                {...register('intake.housing_type')}
                className="min-h-[44px] w-full rounded-lg border sm:h-9 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <option value="">未設定</option>
                {housingTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="intake.facility_name">施設名補足</Label>
              <Input
                id="intake.facility_name"
                {...register('intake.facility_name')}
                placeholder="あおば苑 本館"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="intake.mcs_linked">MCS連携</Label>
              <select
                id="intake.mcs_linked"
                {...register('intake.mcs_linked', optionalBooleanFieldOptions)}
                className="min-h-[44px] w-full rounded-lg border sm:h-9 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <option value="">未設定</option>
                <option value="true">あり</option>
                <option value="false">なし</option>
              </select>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">患者連絡・訪問条件</p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="intake.contact_phone">連絡先電話</Label>
                <Input
                  id="intake.contact_phone"
                  type="tel"
                  {...register('intake.contact_phone')}
                  placeholder="03-3333-4444"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.contact_mobile">連絡先携帯</Label>
                <Input
                  id="intake.contact_mobile"
                  type="tel"
                  {...register('intake.contact_mobile')}
                  placeholder="090-1234-5678"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.primary_contact_preference">主連絡先優先</Label>
                <select
                  id="intake.primary_contact_preference"
                  {...register('intake.primary_contact_preference')}
                  className="min-h-[44px] w-full rounded-lg border sm:h-9 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <option value="">未設定</option>
                  <option value="phone">電話優先</option>
                  <option value="mobile">携帯優先</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.visit_before_contact_required">訪問前連絡</Label>
                <select
                  id="intake.visit_before_contact_required"
                  {...register('intake.visit_before_contact_required', optionalBooleanFieldOptions)}
                  className="min-h-[44px] w-full rounded-lg border sm:h-9 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <option value="">未設定</option>
                  <option value="true">要</option>
                  <option value="false">不要</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.first_visit_preferred_date">初回訪問希望日</Label>
                <Input
                  id="intake.first_visit_preferred_date"
                  type="date"
                  {...register('intake.first_visit_preferred_date', optionalTextFieldOptions)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.first_visit_time_slot">初回訪問時間帯</Label>
                <select
                  id="intake.first_visit_time_slot"
                  {...register('intake.first_visit_time_slot', optionalTextFieldOptions)}
                  className="min-h-[44px] w-full rounded-lg border sm:h-9 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <option value="">未設定</option>
                  {firstVisitSlotOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="intake.first_visit_time_note">初回訪問時間帯補足</Label>
                <Input
                  id="intake.first_visit_time_note"
                  {...register('intake.first_visit_time_note')}
                  placeholder="15時以降 / デイ帰宅後 など"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.parking_available">駐車スペース</Label>
                <select
                  id="intake.parking_available"
                  {...register('intake.parking_available', optionalBooleanFieldOptions)}
                  className="min-h-[44px] w-full rounded-lg border sm:h-9 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <option value="">未設定</option>
                  <option value="true">あり</option>
                  <option value="false">なし</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.initial_transition_management_expected">
                  初期移行管理料見込み
                </Label>
                <select
                  id="intake.initial_transition_management_expected"
                  {...register(
                    'intake.initial_transition_management_expected',
                    optionalBooleanFieldOptions,
                  )}
                  className="min-h-[44px] w-full rounded-lg border sm:h-9 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <option value="">未設定</option>
                  <option value="true">該当見込みあり</option>
                  <option value="false">該当見込みなし</option>
                </select>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">緊急連絡先</p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="intake.emergency_contact.name">氏名</Label>
                <Input
                  id="intake.emergency_contact.name"
                  {...register('intake.emergency_contact.name')}
                  placeholder="家族 花子"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.emergency_contact.relation">関係</Label>
                <Input
                  id="intake.emergency_contact.relation"
                  {...register('intake.emergency_contact.relation')}
                  placeholder="長女"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.emergency_contact.phone">電話番号</Label>
                <Input
                  id="intake.emergency_contact.phone"
                  type="tel"
                  {...register('intake.emergency_contact.phone')}
                  placeholder="090-9876-5432"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">生活背景・薬学的管理</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="intake.care_level">介護認定</Label>
              <select
                id="intake.care_level"
                {...register('intake.care_level')}
                className="min-h-[44px] w-full rounded-lg border sm:h-9 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <option value="">未設定</option>
                {careLevelOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="intake.money_management">金銭管理</Label>
              <select
                id="intake.money_management"
                {...register('intake.money_management')}
                className="min-h-[44px] w-full rounded-lg border sm:h-9 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <option value="">未設定</option>
                {moneyManagementOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="intake.adl_level">ADL</Label>
              <select
                id="intake.adl_level"
                {...register('intake.adl_level')}
                className="min-h-[44px] w-full rounded-lg border sm:h-9 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <option value="">未設定</option>
                {adlOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="intake.dementia_level">認知症自立度</Label>
              <select
                id="intake.dementia_level"
                {...register('intake.dementia_level')}
                className="min-h-[44px] w-full rounded-lg border sm:h-9 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <option value="">未設定</option>
                {dementiaOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="intake.family_key_person">家族構成・キーパーソン</Label>
              <Textarea
                id="intake.family_key_person"
                {...register('intake.family_key_person')}
                rows={2}
                placeholder="長女が服薬管理を支援 / 長男が主連絡先 など"
              />
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">服薬支援・特別処置</p>
            <div className="grid gap-3 md:grid-cols-2">
              {medicationSupportOptions.map((option) => (
                <label
                  key={option.value}
                  className="flex items-start gap-3 rounded-lg border border-border/70 px-3 py-2 text-sm"
                >
                  <Checkbox
                    checked={watchedMedicationSupportMethods.includes(option.value)}
                    onCheckedChange={(checked) =>
                      toggleStringArrayField(
                        'intake.medication_support_methods',
                        watchedMedicationSupportMethods,
                        option.value,
                        checked === true,
                      )
                    }
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="intake.medication_support_other">服薬支援補足</Label>
              <Input
                id="intake.medication_support_other"
                {...register('intake.medication_support_other')}
                placeholder="自己管理困難時は家族同席 など"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="intake.ent_prescription">ENT処方</Label>
                <select
                  id="intake.ent_prescription"
                  {...register('intake.ent_prescription', optionalBooleanFieldOptions)}
                  className="min-h-[44px] w-full rounded-lg border sm:h-9 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <option value="">未設定</option>
                  <option value="true">あり</option>
                  <option value="false">なし</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.swallowing_route">嚥下・投与経路</Label>
                <Input
                  id="intake.swallowing_route"
                  {...register('intake.swallowing_route')}
                  placeholder="経口 / 胃ろう / 経管 など"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.ent_period_from">ENT開始日</Label>
                <Input
                  id="intake.ent_period_from"
                  type="date"
                  {...register('intake.ent_period_from', optionalTextFieldOptions)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.ent_period_to">ENT終了日</Label>
                <Input
                  id="intake.ent_period_to"
                  type="date"
                  {...register('intake.ent_period_to', optionalTextFieldOptions)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.narcotics_base">麻薬ベース</Label>
                <select
                  id="intake.narcotics_base"
                  {...register('intake.narcotics_base', optionalBooleanFieldOptions)}
                  className="min-h-[44px] w-full rounded-lg border sm:h-9 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <option value="">未設定</option>
                  <option value="true">あり</option>
                  <option value="false">なし</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.narcotics_rescue">麻薬レスキュー</Label>
                <select
                  id="intake.narcotics_rescue"
                  {...register('intake.narcotics_rescue', optionalBooleanFieldOptions)}
                  className="min-h-[44px] w-full rounded-lg border sm:h-9 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <option value="">未設定</option>
                  <option value="true">あり</option>
                  <option value="false">なし</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.infection_isolation">感染症・隔離</Label>
                <Input
                  id="intake.infection_isolation"
                  {...register('intake.infection_isolation')}
                  placeholder="接触 / 飛沫 / 空気 など"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.residual_medication_status">残薬状況</Label>
                <Input
                  id="intake.residual_medication_status"
                  {...register('intake.residual_medication_status')}
                  placeholder="残薬多い / 整理済み など"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="intake.allergy_history">アレルギー・副作用歴</Label>
              <Textarea
                id="intake.allergy_history"
                {...register('intake.allergy_history')}
                rows={2}
                placeholder="ペニシリンで発疹 など"
              />
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium text-foreground">特別な医療・処置</p>
              <div className="grid gap-3 md:grid-cols-2">
                {specialProcedureOptions.map((option) => (
                  <label
                    key={option.value}
                    className="flex items-start gap-3 rounded-lg border border-border/70 px-3 py-2 text-sm"
                  >
                    <Checkbox
                      checked={watchedSpecialProcedures.includes(option.value)}
                      onCheckedChange={(checked) =>
                        toggleStringArrayField(
                          'intake.special_medical_procedures',
                          watchedSpecialProcedures,
                          option.value,
                          checked === true,
                        )
                      }
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="intake.special_medical_notes">特別処置の配慮事項</Label>
                <Textarea
                  id="intake.special_medical_notes"
                  {...register('intake.special_medical_notes')}
                  rows={2}
                  placeholder="酸素ボンベ残量確認 / 麻薬金庫あり など"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.other_clinical_notes">臨床メモ</Label>
                <Textarea
                  id="intake.other_clinical_notes"
                  {...register('intake.other_clinical_notes')}
                  rows={2}
                  placeholder="血圧変動あり / 浮腫観察必要 など"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.intake_note">受付メモ</Label>
                <Textarea
                  id="intake.intake_note"
                  {...register('intake.intake_note')}
                  rows={2}
                  placeholder="初回は家族同席希望 / 夕方帯で調整 など"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">多職種連携</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">担当ケアマネジャー</p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="intake.care_manager.name">氏名</Label>
                <Input
                  id="intake.care_manager.name"
                  {...register('intake.care_manager.name')}
                  placeholder="ケア 山田"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.care_manager.name_kana">フリガナ</Label>
                <Input
                  id="intake.care_manager.name_kana"
                  {...register('intake.care_manager.name_kana')}
                  placeholder="ケア ヤマダ"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.care_manager.organization_name">事業所名</Label>
                <Input
                  id="intake.care_manager.organization_name"
                  {...register('intake.care_manager.organization_name')}
                  placeholder="地域ケア支援センター"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.care_manager.phone">電話番号</Label>
                <Input
                  id="intake.care_manager.phone"
                  type="tel"
                  {...register('intake.care_manager.phone')}
                  placeholder="03-9999-0000"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="intake.care_manager.fax">FAX</Label>
                <Input
                  id="intake.care_manager.fax"
                  {...register('intake.care_manager.fax')}
                  placeholder="03-9999-0001"
                />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">訪問看護</p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="intake.visiting_nurse.name">氏名</Label>
                <Input
                  id="intake.visiting_nurse.name"
                  {...register('intake.visiting_nurse.name')}
                  placeholder="看護 佐藤"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.visiting_nurse.name_kana">フリガナ</Label>
                <Input
                  id="intake.visiting_nurse.name_kana"
                  {...register('intake.visiting_nurse.name_kana')}
                  placeholder="カンゴ サトウ"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.visiting_nurse.organization_name">事業所名</Label>
                <Input
                  id="intake.visiting_nurse.organization_name"
                  {...register('intake.visiting_nurse.organization_name')}
                  placeholder="訪問看護ステーションあおば"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.visiting_nurse.phone">電話番号</Label>
                <Input
                  id="intake.visiting_nurse.phone"
                  type="tel"
                  {...register('intake.visiting_nurse.phone')}
                  placeholder="03-8888-7777"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="intake.visiting_nurse.fax">FAX</Label>
                <Input
                  id="intake.visiting_nurse.fax"
                  {...register('intake.visiting_nurse.fax')}
                  placeholder="03-8888-7778"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {activeDuplicates.length > 0 && !duplicateConfirmed && (
        <Alert
          variant="default"
          className="border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-200"
        >
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <AlertDescription className="space-y-2">
            <p className="font-medium">同名の患者が存在します:</p>
            <ul className="list-disc pl-5 text-sm">
              {activeDuplicates.map((d) => {
                const birth = new Date(d.birth_date);
                const birthStr = `${birth.getFullYear()}年${birth.getMonth() + 1}月${birth.getDate()}日生`;
                const genderLabel =
                  d.gender === 'male' ? '男性' : d.gender === 'female' ? '女性' : 'その他';
                return (
                  <li key={d.id}>
                    {d.name}（{birthStr}・{genderLabel}）
                  </li>
                );
              })}
            </ul>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 border-amber-500 text-amber-800 hover:bg-amber-100 dark:border-amber-500 dark:text-amber-200 dark:hover:bg-amber-900"
              onClick={() => setDuplicateConfirmedKey(duplicateLookupKey)}
            >
              それでも登録する
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isSubmitting}
        >
          キャンセル
        </Button>
        <LoadingButton
          type="submit"
          loading={isSubmitting}
          loadingLabel={patientId ? '保存中...' : '登録中...'}
          disabled={activeDuplicates.length > 0 && !duplicateConfirmed}
        >
          {patientId ? '保存する' : '登録する'}
        </LoadingButton>
      </div>
    </form>
  );
}
