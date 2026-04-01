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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormErrorSummary } from '@/components/ui/form-error-summary';
import { LoadingButton } from '@/components/ui/loading-button';
import { collectFormErrorSummaryItems } from '@/lib/forms/errors';
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
  const selectedFacilityId = useWatch({
    control,
    name: 'facility_id',
  }) ?? '';
  const watchedAddress = useWatch({
    control,
    name: 'address',
  }) ?? '';
  const previousFacilityIdRef = useRef<string>('');
  const duplicateLookupKey =
    watchedName?.trim() && watchedBirthDate && watchedGender
      ? `${watchedName.trim()}::${watchedBirthDate}::${watchedGender}`
      : null;
  const duplicateConfirmed = duplicateLookupKey !== null && duplicateConfirmedKey === duplicateLookupKey;
  const activeDuplicates = duplicateLookupKey ? duplicates : [];
  const errorSummaryItems = collectFormErrorSummaryItems(errors, {
    name: '氏名',
    name_kana: 'フリガナ',
    birth_date: '生年月日',
    gender: '性別',
    address: '住所',
  });

  const scrollToErrorSummary = useCallback(() => {
    if (typeof document === 'undefined') return;
    window.requestAnimationFrame(() => {
      const summary = document.getElementById(errorSummaryId);
      summary?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      summary?.focus();
    });
  }, [errorSummaryId]);

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
  }, [watchedName, watchedBirthDate, watchedGender, checkDuplicate]);

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
    <form onSubmit={handleSubmit(onSubmit, scrollToErrorSummary)} noValidate className="space-y-6">
      <FormErrorSummary id={errorSummaryId} items={errorSummaryItems} />

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
              <AlertDescription>
                {serviceAreaWarning.message}
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="facility_id">施設</Label>
              <select
                id="facility_id"
                {...register('facility_id')}
                className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
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
                className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
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
              {selectedFacilityId && !facilityUnitsQuery.isLoading && (facilityUnitsQuery.data?.length ?? 0) === 0 && (
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
              placeholder={selectedFacilityId ? '203号室 / 東棟3F など' : '居宅なら未入力で構いません'}
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

      {activeDuplicates.length > 0 && !duplicateConfirmed && (
        <Alert variant="default" className="border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <AlertDescription className="space-y-2">
            <p className="font-medium">同名の患者が存在します:</p>
            <ul className="list-disc pl-5 text-sm">
              {activeDuplicates.map((d) => {
                const birth = new Date(d.birth_date);
                const birthStr = `${birth.getFullYear()}年${birth.getMonth() + 1}月${birth.getDate()}日生`;
                const genderLabel = d.gender === 'male' ? '男性' : d.gender === 'female' ? '女性' : 'その他';
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
          loadingLabel="登録中..."
          disabled={activeDuplicates.length > 0 && !duplicateConfirmed}
        >
          登録する
        </LoadingButton>
      </div>
    </form>
  );
}
