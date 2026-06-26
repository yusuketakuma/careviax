'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useForm, useWatch, type FieldErrors } from 'react-hook-form';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useUnsavedChangesGuard } from '@/lib/hooks/use-unsaved-changes-guard';
import { collectFormErrorSummaryItems } from '@/lib/forms/errors';
import {
  adlLabels,
  asepticPreparationNeedLabels,
  careLevelLabels,
  confirmationStatusLabels,
  contactMethodLabels,
  dementiaLabels,
  firstVisitSlotLabels,
  homeCareStatusLabels,
  homeCareBillingCategoryLabels,
  homePharmacyAddOn2CandidateLabels,
  emergencyResponseLabels,
  housingTypeLabels,
  medicationSupportLabels,
  medicationManagerLabels,
  medicalHomeManagementSectionLabels,
  medicalHomeManagementTypeLabels,
  moneyManagementLabels,
  narcoticUseCategoryLabels,
  requesterProfessionLabels,
  singleBuildingCountLabels,
  specialProcedureLabels,
  supportStatusLabels,
  triageRiskLabels,
  visitFrequencyLabels,
  visitingNurseFrequencyLabels,
} from '@/lib/patient/home-visit-intake';
import { evaluateServiceAreaWarning, type ServiceAreaRecord } from '@/lib/patient/service-area';

interface DuplicatePatient {
  id: string;
  name: string;
  name_kana: string | null;
  birth_date: string;
  gender: string;
}

type PatientDuplicateConflictPayload = {
  code?: string;
  message?: string;
  details?: {
    duplicate_type?: string;
    duplicates?: DuplicatePatient[];
  };
};

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
const homeCareStatusOptions = formatOptionLabelMap(homeCareStatusLabels);
const emergencyResponseOptions = formatOptionLabelMap(emergencyResponseLabels);
const visitFrequencyOptions = formatOptionLabelMap(visitFrequencyLabels);
const medicationManagerOptions = formatOptionLabelMap(medicationManagerLabels);
const supportStatusOptions = formatOptionLabelMap(supportStatusLabels);
const triageRiskOptions = formatOptionLabelMap(triageRiskLabels);
const medicationSupportOptions = formatOptionLabelMap(medicationSupportLabels);
const specialProcedureOptions = formatOptionLabelMap(specialProcedureLabels);
const addOn2CandidateOptions = formatOptionLabelMap(homePharmacyAddOn2CandidateLabels);
const singleBuildingCountOptions = formatOptionLabelMap(singleBuildingCountLabels);
const homeCareBillingCategoryOptions = formatOptionLabelMap(homeCareBillingCategoryLabels);
const medicalHomeManagementTypeOptions = formatOptionLabelMap(medicalHomeManagementTypeLabels);
const medicalHomeManagementSectionOptions = formatOptionLabelMap(
  medicalHomeManagementSectionLabels,
);
const confirmationStatusOptions = formatOptionLabelMap(confirmationStatusLabels);
const narcoticUseCategoryOptions = formatOptionLabelMap(narcoticUseCategoryLabels);
const asepticPreparationNeedOptions = formatOptionLabelMap(asepticPreparationNeedLabels);
const visitingNurseFrequencyOptions = formatOptionLabelMap(visitingNurseFrequencyLabels);

const PATIENT_FORM_TABS = [
  { value: 'basic', label: '基本' },
  { value: 'contact', label: '住所・保険' },
  { value: 'requester', label: '依頼元' },
  { value: 'visit', label: '訪問' },
  { value: 'care', label: '生活・薬学' },
  { value: 'team', label: '連携' },
] as const;

type PatientFormTab = (typeof PATIENT_FORM_TABS)[number]['value'];

const PATIENT_FORM_HASH_TABS: Record<string, PatientFormTab> = {
  '#patient-form-contact': 'contact',
  '#patient-form-visit': 'visit',
  '#patient-form-care': 'care',
  '#patient-form-team': 'team',
  '#phone': 'contact',
  '#medical_insurance_number': 'contact',
  '#care_insurance_number': 'contact',
  '#intake.contact_phone': 'visit',
  '#intake.contact_mobile': 'visit',
  '#intake.parking_available': 'visit',
  '#intake.care_level': 'care',
  '#intake.care_manager.name': 'team',
  '#intake.visiting_nurse.name': 'team',
};

const PATIENT_FORM_SECTION_TABS: Record<string, PatientFormTab> = {
  basic: 'basic',
  contact: 'contact',
  requester: 'requester',
  visit: 'visit',
  care: 'care',
  team: 'team',
};

function findFirstErrorTab(errors: FieldErrors<CreatePatientInput>): PatientFormTab {
  if (errors.name || errors.name_kana || errors.birth_date || errors.gender) {
    return 'basic';
  }
  if (
    errors.phone ||
    errors.address ||
    errors.facility_id ||
    errors.facility_unit_id ||
    errors.unit_name ||
    errors.medical_insurance_number ||
    errors.care_insurance_number ||
    errors.billing_support_flag
  ) {
    return 'contact';
  }
  if (errors.requester) {
    return 'requester';
  }

  const intakeErrors = errors.intake;
  if (intakeErrors) {
    if ('care_manager' in intakeErrors || 'visiting_nurse' in intakeErrors) {
      return 'team';
    }
    if (
      'care_level' in intakeErrors ||
      'money_management' in intakeErrors ||
      'adl_level' in intakeErrors ||
      'dementia_level' in intakeErrors ||
      'family_key_person' in intakeErrors ||
      'medication_support_methods' in intakeErrors ||
      'medication_support_other' in intakeErrors ||
      'ent_prescription' in intakeErrors ||
      'ent_period_from' in intakeErrors ||
      'ent_period_to' in intakeErrors ||
      'narcotics_base' in intakeErrors ||
      'narcotics_rescue' in intakeErrors ||
      'infection_isolation' in intakeErrors ||
      'swallowing_route' in intakeErrors ||
      'residual_medication_status' in intakeErrors ||
      'allergy_history' in intakeErrors ||
      'special_medical_procedures' in intakeErrors ||
      'special_medical_notes' in intakeErrors ||
      'home_pharmacy_add_on_2' in intakeErrors ||
      'other_clinical_notes' in intakeErrors ||
      'intake_note' in intakeErrors
    ) {
      return 'care';
    }
    return 'visit';
  }

  return 'basic';
}

export function PatientForm({ patientId, redirectTo, onSuccess, defaultValues }: PatientFormProps) {
  const router = useRouter();
  const orgId = useOrgId();
  const [duplicates, setDuplicates] = useState<DuplicatePatient[]>([]);
  const [duplicateConfirmedKey, setDuplicateConfirmedKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<PatientFormTab>('basic');
  // 段階表示: Tabs を内部維持したまま、現在ステップ index と前後ナビを被せる。
  // deep-link(?section=/#patient-form-*) と findFirstErrorTab は従来どおり activeTab を駆動する。
  const currentStepIndex = Math.max(
    0,
    PATIENT_FORM_TABS.findIndex((t) => t.value === activeTab),
  );
  const goStep = (delta: number) =>
    setActiveTab(
      PATIENT_FORM_TABS[
        Math.min(PATIENT_FORM_TABS.length - 1, Math.max(0, currentStepIndex + delta))
      ].value,
    );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAutofilledAddressRef = useRef<string | null>(null);
  const errorSummaryId = 'patient-form-error-summary';

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<CreatePatientInput>({
    resolver: zodResolver(createPatientSchema),
    defaultValues: defaultValues ?? {},
  });

  // 入力中の離脱防止(CLAUDE.md エラー防止)。未保存かつ送信中でないときのみ guard。
  // submit 成功 / キャンセル / 既存患者を開く は allowNavigation() で bypass する。
  const allowNavigation = useUnsavedChangesGuard({ enabled: isDirty && !isSubmitting });

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
  const watchedNarcoticUseCategories =
    useWatch({
      control,
      name: 'intake.home_pharmacy_add_on_2.narcotic_use_categories',
    }) ?? [];
  const watchedBillingSupportFlag =
    useWatch({
      control,
      name: 'billing_support_flag',
    }) ?? false;
  const previousFacilityIdRef = useRef<string>('');
  const duplicateLookupKey =
    watchedName?.trim() && watchedBirthDate && watchedGender
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

  const handleInvalidSubmit = useCallback(
    (formErrors: FieldErrors<CreatePatientInput>) => {
      setActiveTab(findFirstErrorTab(formErrors));
      scrollToErrorSummary();
    },
    [scrollToErrorSummary],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const focusHashTarget = () => {
      if (!window.location.hash || window.location.hash.startsWith('#patient-form-')) return;
      const targetId = decodeURIComponent(window.location.hash.slice(1));
      const target = document.getElementById(targetId);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target?.focus({ preventScroll: true });
    };

    const activateLocationTab = () => {
      const section = new URLSearchParams(window.location.search).get('section');
      const tab =
        PATIENT_FORM_HASH_TABS[window.location.hash] ?? PATIENT_FORM_SECTION_TABS[section ?? ''];
      if (tab) setActiveTab(tab);
      window.requestAnimationFrame(focusHashTarget);
    };

    activateLocationTab();
    window.addEventListener('hashchange', activateLocationTab);
    window.addEventListener('popstate', activateLocationTab);
    return () => {
      window.removeEventListener('hashchange', activateLocationTab);
      window.removeEventListener('popstate', activateLocationTab);
    };
  }, []);

  const toggleStringArrayField = useCallback(
    (
      field:
        | 'intake.medication_support_methods'
        | 'intake.special_medical_procedures'
        | 'intake.home_pharmacy_add_on_2.narcotic_use_categories',
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
    async (name: string, birthDate: string, gender: string, signal?: AbortSignal) => {
      try {
        const params = new URLSearchParams({ name, date_of_birth: birthDate, gender });
        const res = await fetch(`/api/patients/check-duplicate?${params}`, {
          headers: { 'x-org-id': orgId },
          signal,
        });
        if (res.ok) {
          const data = await res.json();
          // 解決済みレスポンスの json parse 中に abort された場合、古い結果での上書きを防ぐ
          if (signal?.aborted) return;
          setDuplicates(data.duplicates ?? []);
        }
      } catch {
        // Silently ignore duplicate check errors (incl. AbortError for superseded requests)
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

  // 担当チーム（患者単位）の候補。編集時のみ取得する（新規登録は別フェーズで対応）。
  const careTeamPharmacistsQuery = useQuery({
    queryKey: ['patient-form', 'care-team-pharmacists', orgId],
    queryFn: async () => {
      const res = await fetch('/api/pharmacists', { headers: { 'x-org-id': orgId } });
      if (!res.ok) throw new Error('薬剤師一覧の取得に失敗しました');
      const payload = (await res.json()) as { data?: Array<{ id: string; name: string }> };
      return payload.data ?? [];
    },
    enabled: !!orgId && !!patientId,
  });

  const careTeamStaffQuery = useQuery({
    queryKey: ['patient-form', 'care-team-staff', orgId],
    queryFn: async () => {
      const res = await fetch('/api/org/members?eligible=staff', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('スタッフ一覧の取得に失敗しました');
      const payload = (await res.json()) as { data?: Array<{ id: string; name: string }> };
      return payload.data ?? [];
    },
    enabled: !!orgId && !!patientId,
  });

  const careTeamPharmacists = careTeamPharmacistsQuery.data ?? [];
  const careTeamStaff = careTeamStaffQuery.data ?? [];
  const careTeamFields = [
    { name: 'primary_pharmacist_id' as const, label: '主担当薬剤師', options: careTeamPharmacists },
    { name: 'backup_pharmacist_id' as const, label: '副担当薬剤師', options: careTeamPharmacists },
    { name: 'primary_staff_id' as const, label: '主担当スタッフ', options: careTeamStaff },
    { name: 'backup_staff_id' as const, label: '副担当スタッフ', options: careTeamStaff },
  ];

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

    const controller = new AbortController();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      checkDuplicate(watchedName.trim(), watchedBirthDate, watchedGender, controller.signal);
    }, 500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      // 入力が更新されたら進行中の重複チェックを中断し、古いレスポンスでの上書きを防ぐ
      controller.abort();
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
    const payload = duplicateConfirmed ? { ...data, duplicate_acknowledged: true } : data;
    const res = await fetch(patientId ? `/api/patients/${patientId}` : '/api/patients', {
      method: patientId ? 'PATCH' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-org-id': orgId,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as PatientDuplicateConflictPayload;
      if (
        res.status === 409 &&
        err.details?.duplicate_type === 'patient_identity' &&
        Array.isArray(err.details.duplicates)
      ) {
        setDuplicates(err.details.duplicates);
        setDuplicateConfirmedKey(null);
        toast.error(err.message ?? '重複している可能性がある患者が存在します');
        return;
      }
      toast.error(err.message ?? (patientId ? '更新に失敗しました' : '登録に失敗しました'));
      return;
    }

    const patient = await res.json();
    toast.success(patientId ? '患者情報を更新しました' : '患者を登録しました');
    allowNavigation(); // 正常保存後の遷移は離脱防止プロンプトを出さない。
    onSuccess?.(patient.id ?? patientId);
    if (redirectTo) {
      router.push(redirectTo);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit, handleInvalidSubmit)} noValidate className="space-y-4">
      <FormErrorSummary
        id={errorSummaryId}
        title={errorSummaryTitle}
        items={errorSummaryItems}
        showMessage={false}
        compact
      />

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as PatientFormTab)}>
        <div className="rounded-lg border border-border/70 bg-card p-2">
          <div
            className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1"
            role="status"
            aria-label={`入力ステップ ${currentStepIndex + 1} / ${PATIENT_FORM_TABS.length}`}
          >
            <p className="text-xs font-medium text-muted-foreground">
              ステップ <span className="tabular-nums text-foreground">{currentStepIndex + 1}</span>{' '}
              / {PATIENT_FORM_TABS.length} — {PATIENT_FORM_TABS[currentStepIndex]?.label}
            </p>
            {!patientId && currentStepIndex === 0 ? (
              <span className="text-[11px] font-medium text-state-done">
                基本情報だけで登録できます（残りは後からでも追記できます）
              </span>
            ) : null}
          </div>
          <TabsList variant="line" className="flex w-full flex-wrap justify-start gap-1">
            {PATIENT_FORM_TABS.map((tab, index) => (
              <TabsTrigger key={tab.value} value={tab.value} className="flex-none px-3">
                <span className="mr-1 tabular-nums text-muted-foreground" aria-hidden="true">
                  {index + 1}.
                </span>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="basic" className="mt-2">
          <Card>
            <CardHeader className="py-4">
              <CardTitle className="text-base">基本情報</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-2">
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

              {/* 担当チーム（患者単位）。編集時のみ。主/副 薬剤師・スタッフを org メンバーから割当。 */}
              {patientId ? (
                <div className="space-y-3 border-t pt-4" data-testid="patient-care-team">
                  <p className="text-sm font-medium text-foreground">担当チーム</p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {careTeamFields.map((field) => (
                      <div key={field.name} className="space-y-1.5">
                        <Label htmlFor={field.name}>{field.label}</Label>
                        <select
                          id={field.name}
                          {...register(field.name)}
                          className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 sm:h-8 sm:min-h-0"
                        >
                          <option value="">未設定</option>
                          {field.options.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent id="patient-form-contact" value="contact" className="mt-2">
          <Card>
            <CardHeader className="py-4">
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
                      ? 'border-state-done/40 bg-state-done/5 text-state-done'
                      : 'border-state-confirm/40 bg-state-confirm/5 text-state-confirm'
                  }
                >
                  <AlertTriangle
                    className={
                      serviceAreaWarning.level === 'covered'
                        ? 'h-4 w-4 text-state-done'
                        : 'h-4 w-4 text-state-confirm'
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
                      <p className="text-xs text-state-confirm" role="status">
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
        </TabsContent>

        <TabsContent value="requester" className="mt-2">
          <Card>
            <CardHeader className="py-4">
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
                  <Input
                    id="requester.fax"
                    {...register('requester.fax')}
                    placeholder="03-1111-3333"
                  />
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
        </TabsContent>

        <TabsContent id="patient-form-visit" value="visit" className="mt-2">
          <Card>
            <CardHeader className="py-4">
              <CardTitle className="text-base">訪問初期情報</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
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
                <p className="text-sm font-medium text-foreground">在宅管理・現地情報</p>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.home_care_status">在宅状態</Label>
                    <select
                      id="intake.home_care_status"
                      {...register('intake.home_care_status', optionalTextFieldOptions)}
                      className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                    >
                      <option value="">未設定</option>
                      {homeCareStatusOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.home_start_date">在宅開始日</Label>
                    <Input
                      id="intake.home_start_date"
                      type="date"
                      {...register('intake.home_start_date', optionalTextFieldOptions)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.home_end_date">在宅終了日</Label>
                    <Input
                      id="intake.home_end_date"
                      type="date"
                      {...register('intake.home_end_date', optionalTextFieldOptions)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.home_end_reason">終了理由</Label>
                    <Input
                      id="intake.home_end_reason"
                      {...register('intake.home_end_reason')}
                      placeholder="入院 / 施設入所 / 他薬局変更 など"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.emergency_response">緊急対応</Label>
                    <select
                      id="intake.emergency_response"
                      {...register('intake.emergency_response', optionalTextFieldOptions)}
                      className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                    >
                      <option value="">未設定</option>
                      {emergencyResponseOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.after_hours_explanation_date">時間外説明日</Label>
                    <Input
                      id="intake.after_hours_explanation_date"
                      type="date"
                      {...register('intake.after_hours_explanation_date', optionalTextFieldOptions)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.visit_frequency">訪問頻度</Label>
                    <select
                      id="intake.visit_frequency"
                      {...register('intake.visit_frequency', optionalTextFieldOptions)}
                      className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                    >
                      <option value="">未設定</option>
                      {visitFrequencyOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.regular_visit_slot">定期訪問枠</Label>
                    <Input
                      id="intake.regular_visit_slot"
                      {...register('intake.regular_visit_slot')}
                      placeholder="月曜午前 / 第2木曜午後 など"
                    />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label htmlFor="intake.visit_available_time_note">訪問可能時間・不在時間</Label>
                    <Input
                      id="intake.visit_available_time_note"
                      {...register('intake.visit_available_time_note')}
                      placeholder="デイ帰宅後 / 午前不在 など"
                    />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label htmlFor="intake.access_key_info">玄関・鍵・現地注意</Label>
                    <Input
                      id="intake.access_key_info"
                      {...register('intake.access_key_info')}
                      placeholder="オートロック / キーボックス / ペット注意 など"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.medication_handover_place">受け渡し場所</Label>
                    <Input
                      id="intake.medication_handover_place"
                      {...register('intake.medication_handover_place')}
                      placeholder="玄関 / 居室 / ナース室"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.medication_storage_location">薬剤保管場所</Label>
                    <Input
                      id="intake.medication_storage_location"
                      {...register('intake.medication_storage_location')}
                      placeholder="居室 / 冷蔵庫 / 金庫"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.collection_method">集金方法</Label>
                    <Input
                      id="intake.collection_method"
                      {...register('intake.collection_method')}
                      placeholder="現金 / 口座振替 / 施設請求"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.payer">支払者</Label>
                    <Input
                      id="intake.payer"
                      {...register('intake.payer')}
                      placeholder="本人 / 家族 / 施設"
                    />
                  </div>
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
                      {...register(
                        'intake.visit_before_contact_required',
                        optionalBooleanFieldOptions,
                      )}
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
        </TabsContent>

        <TabsContent id="patient-form-care" value="care" className="mt-2">
          <Card>
            <CardHeader className="py-4">
              <CardTitle className="text-base">生活背景・薬学的管理</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <p className="text-sm font-medium text-foreground">生活背景</p>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
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
                  {[
                    ['pediatric_home_care', '小児在宅'] as const,
                    ['infant_add_on_candidate', '乳幼児加算候補'] as const,
                    ['medical_care_child', '医療的ケア児'] as const,
                    ['weekly_visiting_nurse', '訪問看護週1以上'] as const,
                  ].map(([field, label]) => (
                    <div key={field} className="space-y-1.5">
                      <Label htmlFor={`intake.home_pharmacy_add_on_2.${field}`}>{label}</Label>
                      <select
                        id={`intake.home_pharmacy_add_on_2.${field}`}
                        {...register(
                          `intake.home_pharmacy_add_on_2.${field}`,
                          optionalTextFieldOptions,
                        )}
                        className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                      >
                        <option value="">未設定</option>
                        {confirmationStatusOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.home_pharmacy_add_on_2.visiting_nurse_frequency">
                      訪問看護頻度
                    </Label>
                    <select
                      id="intake.home_pharmacy_add_on_2.visiting_nurse_frequency"
                      {...register(
                        'intake.home_pharmacy_add_on_2.visiting_nurse_frequency',
                        optionalTextFieldOptions,
                      )}
                      className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                    >
                      <option value="">未設定</option>
                      {visitingNurseFrequencyOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.home_pharmacy_add_on_2.nursing_or_family_procedure">
                      看護・家族処置
                    </Label>
                    <select
                      id="intake.home_pharmacy_add_on_2.nursing_or_family_procedure"
                      {...register(
                        'intake.home_pharmacy_add_on_2.nursing_or_family_procedure',
                        optionalTextFieldOptions,
                      )}
                      className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                    >
                      <option value="">未設定</option>
                      {confirmationStatusOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-sm font-medium text-foreground">算定前提</p>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.home_pharmacy_add_on_2.candidate">候補区分</Label>
                    <select
                      id="intake.home_pharmacy_add_on_2.candidate"
                      {...register(
                        'intake.home_pharmacy_add_on_2.candidate',
                        optionalTextFieldOptions,
                      )}
                      className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                    >
                      <option value="">未設定</option>
                      {addOn2CandidateOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.home_pharmacy_add_on_2.home_care_billing_category">
                      算定対象
                    </Label>
                    <select
                      id="intake.home_pharmacy_add_on_2.home_care_billing_category"
                      {...register(
                        'intake.home_pharmacy_add_on_2.home_care_billing_category',
                        optionalTextFieldOptions,
                      )}
                      className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                    >
                      <option value="">未設定</option>
                      {homeCareBillingCategoryOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.home_pharmacy_add_on_2.comprehensive_support_add_on">
                      包括的支援加算
                    </Label>
                    <select
                      id="intake.home_pharmacy_add_on_2.comprehensive_support_add_on"
                      {...register(
                        'intake.home_pharmacy_add_on_2.comprehensive_support_add_on',
                        optionalTextFieldOptions,
                      )}
                      className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                    >
                      <option value="">未設定</option>
                      {confirmationStatusOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.home_pharmacy_add_on_2.single_building_medical_patient_count">
                      単一建物の医療患者数
                    </Label>
                    <select
                      id="intake.home_pharmacy_add_on_2.single_building_medical_patient_count"
                      {...register(
                        'intake.home_pharmacy_add_on_2.single_building_medical_patient_count',
                        optionalTextFieldOptions,
                      )}
                      className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                    >
                      <option value="">未設定</option>
                      {singleBuildingCountOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.home_pharmacy_add_on_2.single_building_resident_count">
                      単一建物の居住者数
                    </Label>
                    <select
                      id="intake.home_pharmacy_add_on_2.single_building_resident_count"
                      {...register(
                        'intake.home_pharmacy_add_on_2.single_building_resident_count',
                        optionalTextFieldOptions,
                      )}
                      className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                    >
                      <option value="">未設定</option>
                      {singleBuildingCountOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.home_pharmacy_add_on_2.medical_home_management_type">
                      医学管理
                    </Label>
                    <select
                      id="intake.home_pharmacy_add_on_2.medical_home_management_type"
                      {...register(
                        'intake.home_pharmacy_add_on_2.medical_home_management_type',
                        optionalTextFieldOptions,
                      )}
                      className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                    >
                      <option value="">未設定</option>
                      {medicalHomeManagementTypeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.home_pharmacy_add_on_2.medical_home_management_section">
                      医学管理区分
                    </Label>
                    <select
                      id="intake.home_pharmacy_add_on_2.medical_home_management_section"
                      {...register(
                        'intake.home_pharmacy_add_on_2.medical_home_management_section',
                        optionalTextFieldOptions,
                      )}
                      className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                    >
                      <option value="">未設定</option>
                      {medicalHomeManagementSectionOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.home_pharmacy_add_on_2.table_8_2_applicable">
                      別表8の2
                    </Label>
                    <select
                      id="intake.home_pharmacy_add_on_2.table_8_2_applicable"
                      {...register(
                        'intake.home_pharmacy_add_on_2.table_8_2_applicable',
                        optionalTextFieldOptions,
                      )}
                      className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                    >
                      <option value="">未設定</option>
                      {confirmationStatusOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.home_pharmacy_add_on_2.table_8_3_applicable">
                      別表8の3
                    </Label>
                    <select
                      id="intake.home_pharmacy_add_on_2.table_8_3_applicable"
                      {...register(
                        'intake.home_pharmacy_add_on_2.table_8_3_applicable',
                        optionalTextFieldOptions,
                      )}
                      className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                    >
                      <option value="">未設定</option>
                      {confirmationStatusOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-sm font-medium text-foreground">服薬支援</p>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.medication_manager">服薬管理者</Label>
                    <select
                      id="intake.medication_manager"
                      {...register('intake.medication_manager', optionalTextFieldOptions)}
                      className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                    >
                      <option value="">未設定</option>
                      {medicationManagerOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.medication_ability">服薬能力</Label>
                    <Input
                      id="intake.medication_ability"
                      {...register('intake.medication_ability')}
                      placeholder="自立 / 一部介助 / 全介助"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.missed_dose_pattern">飲み忘れ傾向</Label>
                    <Input
                      id="intake.missed_dose_pattern"
                      {...register('intake.missed_dose_pattern')}
                      placeholder="朝 / 夕 / 眠前 / 頓服 など"
                    />
                  </div>
                </div>
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
                <div className="space-y-1.5">
                  <Label htmlFor="intake.residual_medication_status">残薬状況</Label>
                  <Input
                    id="intake.residual_medication_status"
                    {...register('intake.residual_medication_status')}
                    placeholder="残薬多い / 整理済み など"
                  />
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.residual_medication_pattern">残薬パターン</Label>
                    <Input
                      id="intake.residual_medication_pattern"
                      {...register('intake.residual_medication_pattern')}
                      placeholder="全体 / 特定薬剤 / 頓服 / 外用"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.residual_medication_checked_on">残薬確認日</Label>
                    <Input
                      id="intake.residual_medication_checked_on"
                      type="date"
                      {...register(
                        'intake.residual_medication_checked_on',
                        optionalTextFieldOptions,
                      )}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.residual_adjustment_status">残薬調整提案</Label>
                    <select
                      id="intake.residual_adjustment_status"
                      {...register('intake.residual_adjustment_status', optionalTextFieldOptions)}
                      className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                    >
                      <option value="">未設定</option>
                      {supportStatusOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.crushing_check_status">粉砕可否</Label>
                    <select
                      id="intake.crushing_check_status"
                      {...register('intake.crushing_check_status', optionalTextFieldOptions)}
                      className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                    >
                      <option value="">未設定</option>
                      {confirmationStatusOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.simple_suspension_check_status">簡易懸濁可否</Label>
                    <select
                      id="intake.simple_suspension_check_status"
                      {...register(
                        'intake.simple_suspension_check_status',
                        optionalTextFieldOptions,
                      )}
                      className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                    >
                      <option value="">未設定</option>
                      {confirmationStatusOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.fall_risk">転倒リスク</Label>
                    <select
                      id="intake.fall_risk"
                      {...register('intake.fall_risk', optionalTextFieldOptions)}
                      className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                    >
                      <option value="">未設定</option>
                      {triageRiskOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-sm font-medium text-foreground">医療処置</p>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
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
                    <Label htmlFor="intake.home_pharmacy_add_on_2.aseptic_preparation_need">
                      無菌調製の要否
                    </Label>
                    <select
                      id="intake.home_pharmacy_add_on_2.aseptic_preparation_need"
                      {...register(
                        'intake.home_pharmacy_add_on_2.aseptic_preparation_need',
                        optionalTextFieldOptions,
                      )}
                      className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                    >
                      <option value="">未設定</option>
                      {asepticPreparationNeedOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.home_pharmacy_add_on_2.medical_material_supply">
                      医療材料供給
                    </Label>
                    <select
                      id="intake.home_pharmacy_add_on_2.medical_material_supply"
                      {...register(
                        'intake.home_pharmacy_add_on_2.medical_material_supply',
                        optionalTextFieldOptions,
                      )}
                      className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                    >
                      <option value="">未設定</option>
                      {confirmationStatusOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.home_pharmacy_add_on_2.advanced_medical_device">
                      高度医療機器
                    </Label>
                    <select
                      id="intake.home_pharmacy_add_on_2.advanced_medical_device"
                      {...register(
                        'intake.home_pharmacy_add_on_2.advanced_medical_device',
                        optionalTextFieldOptions,
                      )}
                      className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                    >
                      <option value="">未設定</option>
                      {confirmationStatusOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="text-sm font-medium text-foreground">麻薬区分</p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                    {narcoticUseCategoryOptions.map((option) => (
                      <label
                        key={option.value}
                        className="flex items-start gap-2 rounded-lg border border-border/70 px-3 py-2 text-sm"
                      >
                        <Checkbox
                          checked={watchedNarcoticUseCategories.includes(option.value)}
                          onCheckedChange={(checked) =>
                            toggleStringArrayField(
                              'intake.home_pharmacy_add_on_2.narcotic_use_categories',
                              watchedNarcoticUseCategories,
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

                <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.pain_score">疼痛スコア</Label>
                    <Input
                      id="intake.pain_score"
                      {...register('intake.pain_score')}
                      placeholder="NRS 0-10"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.rescue_use_count_recent">レスキュー使用</Label>
                    <Input
                      id="intake.rescue_use_count_recent"
                      {...register('intake.rescue_use_count_recent')}
                      placeholder="直近24h 2回 / 3日で5回"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.constipation_status">便秘対策</Label>
                    <Input
                      id="intake.constipation_status"
                      {...register('intake.constipation_status')}
                      placeholder="下剤あり / 最終排便 など"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.drowsiness_delirium_status">眠気・せん妄</Label>
                    <Input
                      id="intake.drowsiness_delirium_status"
                      {...register('intake.drowsiness_delirium_status')}
                      placeholder="なし / 軽度 / 要観察"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.egfr_value">eGFR</Label>
                    <Input
                      id="intake.egfr_value"
                      {...register('intake.egfr_value')}
                      placeholder="38"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.egfr_measured_on">eGFR測定日</Label>
                    <Input
                      id="intake.egfr_measured_on"
                      type="date"
                      {...register('intake.egfr_measured_on', optionalTextFieldOptions)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.weight_kg">体重</Label>
                    <Input
                      id="intake.weight_kg"
                      {...register('intake.weight_kg')}
                      placeholder="45.2kg"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.weight_measured_on">体重測定日</Label>
                    <Input
                      id="intake.weight_measured_on"
                      type="date"
                      {...register('intake.weight_measured_on', optionalTextFieldOptions)}
                    />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label htmlFor="intake.medical_material_supplier">医療材料供給担当</Label>
                    <Input
                      id="intake.medical_material_supplier"
                      {...register('intake.medical_material_supplier')}
                      placeholder="薬局 / 訪看 / 医療機関 / 業者"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.material_exchange_due_note">交換期限</Label>
                    <Input
                      id="intake.material_exchange_due_note"
                      {...register('intake.material_exchange_due_note')}
                      placeholder="ルート交換 6/20 など"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.device_vendor_contact">業者連絡先</Label>
                    <Input
                      id="intake.device_vendor_contact"
                      {...register('intake.device_vendor_contact')}
                      placeholder="酸素業者 / ポンプ業者"
                    />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label htmlFor="intake.pressure_ulcer_status">褥瘡・創傷</Label>
                    <Input
                      id="intake.pressure_ulcer_status"
                      {...register('intake.pressure_ulcer_status')}
                      placeholder="仙骨 / DESIGN-R / 処置材料 など"
                    />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label htmlFor="intake.emergency_policy_note">緊急時方針</Label>
                    <Input
                      id="intake.emergency_policy_note"
                      {...register('intake.emergency_policy_note')}
                      placeholder="まず主治医 / 訪看へ連絡 / 搬送希望 など"
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
        </TabsContent>

        <TabsContent id="patient-form-team" value="team" className="mt-2">
          <Card>
            <CardHeader className="py-4">
              <CardTitle className="text-base">多職種連携</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
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

              <div className="space-y-3">
                <p className="text-sm font-medium text-foreground">連携ルール・書類</p>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.report_destination_note">報告書送付先・頻度</Label>
                    <Textarea
                      id="intake.report_destination_note"
                      {...register('intake.report_destination_note')}
                      rows={2}
                      placeholder="医師・CMへ毎回 / 訪看へ変化時のみ など"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intake.document_status_note">書類・期限メモ</Label>
                    <Textarea
                      id="intake.document_status_note"
                      {...register('intake.document_status_note')}
                      rows={2}
                      placeholder="同意書未取得 / 計画書更新 6/30 / 報告書送付済 など"
                    />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label htmlFor="intake.interprofessional_action_note">
                      連携ログ・次アクション
                    </Label>
                    <Textarea
                      id="intake.interprofessional_action_note"
                      {...register('intake.interprofessional_action_note')}
                      rows={2}
                      placeholder="訪看へ残薬共有 / 主治医へ便秘対策相談 / CMへ集金方法確認 など"
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {activeDuplicates.length > 0 && !duplicateConfirmed && (
        <Alert
          variant="default"
          className="border-state-confirm/40 bg-state-confirm/5 text-state-confirm"
        >
          <AlertTriangle className="h-4 w-4 text-state-confirm" />
          <AlertDescription className="space-y-2">
            <p className="font-medium">同名の患者が存在します:</p>
            <ul className="list-disc pl-5 text-sm">
              {activeDuplicates.map((d) => {
                const birth = new Date(d.birth_date);
                const birthStr = `${birth.getFullYear()}年${birth.getMonth() + 1}月${birth.getDate()}日生`;
                const genderLabel =
                  d.gender === 'male' ? '男性' : d.gender === 'female' ? '女性' : 'その他';
                return (
                  <li key={d.id} className="flex flex-wrap items-center gap-2">
                    <span>
                      {d.name}（{birthStr}・{genderLabel}）
                    </span>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-state-confirm underline-offset-2"
                      onClick={() => {
                        allowNavigation();
                        router.push(`/patients/${encodeURIComponent(d.id)}`);
                      }}
                    >
                      既存患者を開く
                    </Button>
                  </li>
                );
              })}
            </ul>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 border-state-confirm/50 text-state-confirm hover:bg-state-confirm/10"
              onClick={() => setDuplicateConfirmedKey(duplicateLookupKey)}
            >
              それでも登録する
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* 段階ナビ: 任意ステップを順に進む。登録ボタンは常時表示(Step1 のみで登録可)。 */}
      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => goStep(-1)}
          disabled={currentStepIndex === 0 || isSubmitting}
        >
          ← 戻る
        </Button>
        {currentStepIndex < PATIENT_FORM_TABS.length - 1 ? (
          <Button type="button" variant="outline" size="sm" onClick={() => goStep(1)}>
            次へ: {PATIENT_FORM_TABS[currentStepIndex + 1].label} →
          </Button>
        ) : (
          <span />
        )}
      </div>

      <div className="flex justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            allowNavigation();
            router.back();
          }}
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
