'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { FormProvider, useForm, useWatch, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { buildPatientHref } from '@/lib/patient/navigation';
import {
  PATIENTS_API_PATH,
  buildPatientApiPath,
  buildPatientDuplicateCheckApiPath,
} from '@/lib/patient/api-paths';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import {
  ADMIN_FACILITIES_API_PATH,
  buildAdminFacilityUnitsApiPath,
} from '@/lib/facilities/api-paths';
import { readApiJson } from '@/lib/api/client-json';
import { SERVICE_AREAS_API_PATH } from '@/lib/service-areas/api-paths';
import { PHARMACISTS_API_PATH } from '@/lib/pharmacists/api-paths';
import { buildOrgMembersApiPath } from '@/lib/org-members/api-paths';
import { createPatientSchema, type CreatePatientInput } from '@/lib/validations/patient';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { messageFromError } from '@/lib/utils/error-message';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FormErrorSummary } from '@/components/ui/form-error-summary';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useUnsavedChangesGuard } from '@/lib/hooks/use-unsaved-changes-guard';
import { collectFormErrorSummaryItems } from '@/lib/forms/errors';
import { evaluateServiceAreaWarning } from '@/lib/patient/service-area';
import {
  patientDuplicateCheckResponseSchema,
  patientFormFacilitiesResponseSchema,
  patientFormFacilityUnitsResponseSchema,
  patientFormPharmacistsResponseSchema,
  patientFormServiceAreasResponseSchema,
  patientFormStaffResponseSchema,
} from './patient-form-response-schemas';
import {
  buildPatientEditPayload,
  hasPatientEditConcurrencyAuthority,
  isPatientEditConflictType,
  isPatientSchedulingPreferenceFieldName,
  isValidPatientEditAcknowledgement,
  type PatientCareCaseRevision,
  type PatientEditConcurrencyAuthority,
  type PatientEditConflictType,
} from './patient-form-occ';
import {
  PatientFormBasicSection,
  PatientFormContactSection,
  type FacilityOption,
  type FacilityUnitOption,
  type ServiceAreaOption,
} from './patient-form-basic-contact-sections';
import {
  PatientFormRequesterSection,
  PatientFormVisitSection,
} from './patient-form-requester-visit-sections';
import { PatientFormCareSection } from './patient-form-care-section';
import { PatientFormConcurrencyAlert } from './patient-form-concurrency-alert';
import { PatientFormTeamSection } from './patient-form-team-section';
import { PatientFormActions, type DuplicatePatient } from './patient-form-actions';

type PatientDuplicateConflictPayload = {
  code?: string;
  message?: string;
  details?: {
    duplicate_type?: string;
    duplicates?: DuplicatePatient[];
    conflict_type?: string;
  };
};

const qualificationCheckPayloadSchema = z
  .object({
    data: z
      .object({
        valid: z.boolean(),
        identityMatch: z.enum(['matched', 'mismatch', 'unknown']),
        payerName: z.string().nullable(),
        payerType: z.enum(['medical', 'care', 'public', 'unknown']),
        copayRatio: z.number().nullable(),
        coverage: z
          .object({
            startDate: z.string().nullable(),
            endDate: z.string().nullable(),
          })
          .strict(),
        warnings: z.array(z.string()),
      })
      .strict()
      .nullable(),
    meta: z
      .object({
        capabilities: z
          .object({
            supportsOnlineLookup: z.boolean(),
            supportsBenefitHistory: z.boolean(),
            supportsCareInsurance: z.boolean(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

type QualificationCheckPayload = z.infer<typeof qualificationCheckPayloadSchema>;

const patientSaveDataSchema = z
  .object({
    id: z.string().trim().min(1),
  })
  .passthrough();

const patientSaveWarningSchema = z
  .object({
    code: z.string(),
    severity: z.literal('warning'),
    message: z.string(),
  })
  .strict();

const patientCreateResponseSchema = z
  .object({
    data: patientSaveDataSchema,
    meta: z
      .object({
        warnings: z.array(patientSaveWarningSchema),
        duplicate_acknowledged: z.boolean(),
        duplicate_candidate_count: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

const patientUpdateResponseSchema = z
  .object({
    data: patientSaveDataSchema.extend({
      updated_at: z.string().datetime({ offset: true }),
    }),
    meta: z
      .object({
        warnings: z.array(patientSaveWarningSchema),
        duplicate_candidates: z.array(z.unknown()),
        version_basis: z
          .object({
            patient_updated_at: z.string().datetime(),
            care_case_id: z.string().trim().min(1).nullable(),
            care_case_version: z.number().int().positive().nullable(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

interface PatientFormProps {
  /** When provided, submits an update instead of a create */
  patientId?: string;
  /** Where to redirect after successful submission */
  redirectTo?: string;
  /** Called with the created patient id, in addition to redirect */
  onSuccess?: (patientId: string) => void;
  /** Initial values (for embedded use in referral form) */
  defaultValues?: Partial<CreatePatientInput>;
  /** Optimistic concurrency anchor for editing an existing patient */
  expectedUpdatedAt?: string | null;
  /** Exact care-case revision selected by the overview projection */
  selectedCareCase?: PatientCareCaseRevision | null;
  /** Refreshes patient/care-case OCC authority after an explicit 409 recovery action */
  onRefreshConcurrencyAuthority?: (context: {
    patientId: string;
    conflictType: PatientEditConflictType;
  }) => Promise<PatientEditConcurrencyAuthority | null>;
}

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

export function PatientForm({
  patientId,
  redirectTo,
  onSuccess,
  defaultValues,
  expectedUpdatedAt,
  selectedCareCase = null,
  onRefreshConcurrencyAuthority,
}: PatientFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const orgId = useOrgId();
  const [duplicates, setDuplicates] = useState<DuplicatePatient[]>([]);
  const [duplicateConfirmedKey, setDuplicateConfirmedKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<PatientFormTab>('basic');
  const [qualificationCheckPending, setQualificationCheckPending] = useState(false);
  const [qualificationCheckMessage, setQualificationCheckMessage] = useState<{
    tone: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);
  const concurrencyAuthoritySourceKey = `${expectedUpdatedAt ?? ''}\u0000${selectedCareCase?.id ?? ''}\u0000${selectedCareCase?.version ?? ''}`;
  const [refreshedConcurrencyAuthority, setRefreshedConcurrencyAuthority] = useState<{
    sourceKey: string;
    authority: PatientEditConcurrencyAuthority;
  } | null>(null);
  const concurrencyAuthority =
    refreshedConcurrencyAuthority?.sourceKey === concurrencyAuthoritySourceKey
      ? refreshedConcurrencyAuthority.authority
      : {
          expectedUpdatedAt: expectedUpdatedAt ?? '',
          selectedCareCase,
        };
  const [concurrencyConflict, setConcurrencyConflict] = useState<{
    type: PatientEditConflictType;
    phase: 'refresh-required' | 'refreshing' | 'reconfirm-required' | 'refresh-failed';
  } | null>(null);
  const [reconfirmingConflictType, setReconfirmingConflictType] =
    useState<PatientEditConflictType | null>(null);

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

  useEffect(() => {
    if (!patientId || concurrencyAuthority.selectedCareCase || !formRef.current) return;
    const controls = formRef.current.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >('[name^="requester."], [name^="intake."]');
    const originalDisabled = new Map<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
      boolean
    >();
    for (const control of controls) {
      if (isPatientSchedulingPreferenceFieldName(control.name)) continue;
      originalDisabled.set(control, control.disabled);
      control.disabled = true;
      control.setAttribute('aria-describedby', 'patient-care-case-unavailable');
    }
    return () => {
      for (const [control, wasDisabled] of originalDisabled) {
        control.disabled = wasDisabled;
        if (control.getAttribute('aria-describedby') === 'patient-care-case-unavailable') {
          control.removeAttribute('aria-describedby');
        }
      }
    };
  }, [activeTab, concurrencyAuthority.selectedCareCase, patientId]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAutofilledAddressRef = useRef<string | null>(null);
  const errorSummaryId = 'patient-form-error-summary';

  const form = useForm<CreatePatientInput>({
    resolver: zodResolver(createPatientSchema),
    defaultValues: defaultValues ?? {},
  });
  const {
    handleSubmit,
    control,
    setValue,
    formState: { dirtyFields, errors, isSubmitting, isDirty },
  } = form;

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

  const checkDuplicate = useCallback(
    async (name: string, birthDate: string, gender: string, signal?: AbortSignal) => {
      try {
        const params = new URLSearchParams({ name, date_of_birth: birthDate, gender });
        const res = await fetch(buildPatientDuplicateCheckApiPath(params), {
          headers: buildOrgHeaders(orgId),
          signal,
        });
        if (res.ok) {
          const payload = await readApiJson<{ data: { duplicates: DuplicatePatient[] } }>(res, {
            fallbackMessage: '重複候補の確認に失敗しました',
            schema: patientDuplicateCheckResponseSchema,
          });
          // 解決済みレスポンスの json parse 中に abort された場合、古い結果での上書きを防ぐ
          if (signal?.aborted) return;
          setDuplicates(payload.data.duplicates);
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
      const res = await fetch(ADMIN_FACILITIES_API_PATH, {
        headers: buildOrgHeaders(orgId),
      });
      const payload = await readApiJson<{ data: FacilityOption[] }>(res, {
        fallbackMessage: '施設一覧の取得に失敗しました',
        schema: patientFormFacilitiesResponseSchema,
      });
      return payload.data;
    },
    enabled: !!orgId,
  });

  const facilityUnitsQuery = useQuery({
    queryKey: ['patient-form', 'facility-units', orgId, selectedFacilityId],
    queryFn: async () => {
      const res = await fetch(buildAdminFacilityUnitsApiPath(selectedFacilityId), {
        headers: buildOrgHeaders(orgId),
      });
      const payload = await readApiJson<{ data: FacilityUnitOption[] }>(res, {
        fallbackMessage: 'ユニット一覧の取得に失敗しました',
        schema: patientFormFacilityUnitsResponseSchema,
      });
      return payload.data;
    },
    enabled: !!orgId && !!selectedFacilityId,
  });

  const serviceAreasQuery = useQuery({
    queryKey: ['patient-form', 'service-areas', orgId],
    queryFn: async () => {
      const res = await fetch(SERVICE_AREAS_API_PATH, {
        headers: buildOrgHeaders(orgId),
      });
      const payload = await readApiJson<{ data: ServiceAreaOption[] }>(res, {
        fallbackMessage: '訪問エリア設定の取得に失敗しました',
        schema: patientFormServiceAreasResponseSchema,
      });
      return payload.data;
    },
    enabled: !!orgId,
  });

  // 担当チーム（患者単位）の候補。新規登録・編集の双方で取得する（POST/PATCH とも 4id を永続化）。
  const careTeamPharmacistsQuery = useQuery({
    queryKey: ['patient-form', 'care-team-pharmacists', orgId],
    queryFn: async () => {
      const res = await fetch(PHARMACISTS_API_PATH, { headers: buildOrgHeaders(orgId) });
      const payload = await readApiJson<{ data: Array<{ id: string; name: string }> }>(res, {
        fallbackMessage: '薬剤師一覧の取得に失敗しました',
        schema: patientFormPharmacistsResponseSchema,
      });
      return payload.data;
    },
    enabled: !!orgId,
  });

  const careTeamStaffQuery = useQuery({
    queryKey: ['patient-form', 'care-team-staff', orgId],
    queryFn: async () => {
      const params = new URLSearchParams({ eligible: 'staff' });
      const res = await fetch(buildOrgMembersApiPath(params), {
        headers: buildOrgHeaders(orgId),
      });
      const payload = await readApiJson<{ data: Array<{ id: string; name: string }> }>(res, {
        fallbackMessage: 'スタッフ一覧の取得に失敗しました',
        schema: patientFormStaffResponseSchema,
      });
      return payload.data;
    },
    enabled: !!orgId,
  });

  const careTeamPharmacists = careTeamPharmacistsQuery.data ?? [];
  const careTeamStaff = careTeamStaffQuery.data ?? [];
  const careTeamPharmacistsLoadFailed = Boolean(careTeamPharmacistsQuery.isError);
  const careTeamStaffLoadFailed = Boolean(careTeamStaffQuery.isError);
  const careTeamFields = [
    {
      name: 'primary_pharmacist_id' as const,
      label: '主担当薬剤師',
      options: careTeamPharmacists,
      isLoading: careTeamPharmacistsQuery.isLoading,
      loadFailed: careTeamPharmacistsLoadFailed,
      loadingPlaceholder: '薬剤師候補を読み込み中...',
      failedPlaceholder: '薬剤師候補を取得できません',
    },
    {
      name: 'backup_pharmacist_id' as const,
      label: '副担当薬剤師',
      options: careTeamPharmacists,
      isLoading: careTeamPharmacistsQuery.isLoading,
      loadFailed: careTeamPharmacistsLoadFailed,
      loadingPlaceholder: '薬剤師候補を読み込み中...',
      failedPlaceholder: '薬剤師候補を取得できません',
    },
    {
      name: 'primary_staff_id' as const,
      label: '主担当スタッフ',
      options: careTeamStaff,
      isLoading: careTeamStaffQuery.isLoading,
      loadFailed: careTeamStaffLoadFailed,
      loadingPlaceholder: 'スタッフ候補を読み込み中...',
      failedPlaceholder: 'スタッフ候補を取得できません',
    },
    {
      name: 'backup_staff_id' as const,
      label: '副担当スタッフ',
      options: careTeamStaff,
      isLoading: careTeamStaffQuery.isLoading,
      loadFailed: careTeamStaffLoadFailed,
      loadingPlaceholder: 'スタッフ候補を読み込み中...',
      failedPlaceholder: 'スタッフ候補を取得できません',
    },
  ];

  const serviceAreasLoadFailed = Boolean(serviceAreasQuery.isError);
  const serviceAreaWarning = serviceAreasLoadFailed
    ? null
    : evaluateServiceAreaWarning({
        serviceAreas: serviceAreasQuery.data ?? [],
        address: watchedAddress,
        facilityId: selectedFacilityId || null,
      });
  const facilityUnitsLoadFailed = Boolean(selectedFacilityId && facilityUnitsQuery.isError);

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
    if (concurrencyConflict) {
      toast.error('最新の版を確認し、入力内容を再確認してから再送してください');
      return;
    }
    if (patientId && !hasPatientEditConcurrencyAuthority(concurrencyAuthority.expectedUpdatedAt)) {
      toast.error('更新元の版を確認できません。患者情報を再読み込みしてください');
      return;
    }
    let payload: Record<string, unknown>;
    try {
      payload = patientId
        ? buildPatientEditPayload({
            data,
            expectedUpdatedAt: concurrencyAuthority.expectedUpdatedAt,
            selectedCareCase: concurrencyAuthority.selectedCareCase,
            duplicateAcknowledged: duplicateConfirmed,
            dirtyFields,
          })
        : {
            ...data,
            ...(duplicateConfirmed ? { duplicate_acknowledged: true } : {}),
          };
    } catch {
      toast.error('訪問ケースに属する入力は、対象ケースを選択してから保存してください');
      return;
    }
    const res = await fetch(patientId ? buildPatientApiPath(patientId) : PATIENTS_API_PATH, {
      method: patientId ? 'PATCH' : 'POST',
      headers: buildOrgJsonHeaders(orgId),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as PatientDuplicateConflictPayload;
      const conflictType = err.details?.conflict_type;
      if (patientId && res.status === 409 && isPatientEditConflictType(conflictType)) {
        setConcurrencyConflict({ type: conflictType, phase: 'refresh-required' });
        toast.error('他の更新が反映されています。最新の版を確認してから再送してください');
        return;
      }
      if (
        res.status === 409 &&
        err.details?.duplicate_type === 'patient_identity' &&
        Array.isArray(err.details.duplicates)
      ) {
        setDuplicates(err.details.duplicates);
        setDuplicateConfirmedKey(null);
        toast.error(
          messageFromError(
            new Error(err.message ?? ''),
            '重複している可能性がある患者が存在します',
          ),
        );
        return;
      }
      toast.error(
        messageFromError(
          new Error(err.message ?? ''),
          patientId ? '更新に失敗しました' : '登録に失敗しました',
        ),
      );
      return;
    }

    let patient: { data: { id: string } };
    try {
      if (patientId) {
        const acknowledgement = await readApiJson(res, {
          fallbackMessage: '更新に失敗しました',
          schema: patientUpdateResponseSchema,
        });
        if (
          !isValidPatientEditAcknowledgement(acknowledgement, {
            patientId,
            expectedUpdatedAt: String(payload.expected_updated_at),
            careCaseId: typeof payload.care_case_id === 'string' ? payload.care_case_id : null,
            expectedCareCaseVersion:
              typeof payload.expected_care_case_version === 'number'
                ? payload.expected_care_case_version
                : null,
          })
        ) {
          throw new Error('Patient update acknowledgement did not match the pending mutation');
        }
        patient = acknowledgement;
      } else {
        patient = await readApiJson(res, {
          fallbackMessage: '登録に失敗しました',
          schema: patientCreateResponseSchema,
        });
      }
    } catch (error) {
      if (reconfirmingConflictType) {
        setConcurrencyConflict({ type: reconfirmingConflictType, phase: 'reconfirm-required' });
      }
      setReconfirmingConflictType(null);
      toast.error(messageFromError(error, patientId ? '更新に失敗しました' : '登録に失敗しました'));
      return;
    }
    setReconfirmingConflictType(null);
    toast.success(patientId ? '患者情報を更新しました' : '患者を登録しました');
    allowNavigation(); // 正常保存後の遷移は離脱防止プロンプトを出さない。
    onSuccess?.(patient.data.id);
    if (redirectTo) {
      router.push(redirectTo);
    }
  }

  async function refreshConcurrencyAuthority() {
    if (!patientId || !concurrencyConflict || !onRefreshConcurrencyAuthority) return;
    const conflictType = concurrencyConflict.type;
    setConcurrencyConflict({ type: conflictType, phase: 'refreshing' });
    try {
      const authority = await onRefreshConcurrencyAuthority({ patientId, conflictType });
      if (!authority || !hasPatientEditConcurrencyAuthority(authority.expectedUpdatedAt)) {
        throw new Error('Missing refreshed patient concurrency authority');
      }
      setRefreshedConcurrencyAuthority({
        sourceKey: concurrencyAuthoritySourceKey,
        authority,
      });
      setConcurrencyConflict({ type: conflictType, phase: 'reconfirm-required' });
    } catch {
      setConcurrencyConflict({ type: conflictType, phase: 'refresh-failed' });
      toast.error('最新の版を取得できませんでした。通信状態を確認して再試行してください');
    }
  }

  function reconfirmAndRetryPatch() {
    setReconfirmingConflictType(concurrencyConflict?.type ?? null);
    setConcurrencyConflict(null);
    window.requestAnimationFrame(() => formRef.current?.requestSubmit());
  }

  async function handleQualificationCheck() {
    if (!patientId) return;
    setQualificationCheckPending(true);
    setQualificationCheckMessage(null);

    try {
      const res = await fetch(buildPatientApiPath(patientId, '/qualification-check'), {
        method: 'POST',
        headers: buildOrgHeaders(orgId),
      });
      const payload = await readApiJson<QualificationCheckPayload>(res, {
        fallbackMessage: '資格確認に失敗しました',
        schema: qualificationCheckPayloadSchema,
      });

      const result = payload.data ?? null;
      if (!result) {
        const message = '資格情報が見つかりませんでした';
        setQualificationCheckMessage({ tone: 'warning', text: message });
        toast.error(message);
        return;
      }

      const warnings = result.warnings?.filter(Boolean) ?? [];
      const payer = result.payerName ?? '保険者不明';
      const copay =
        typeof result.copayRatio === 'number'
          ? ` / 負担割合 ${Math.round(result.copayRatio * 100)}%`
          : '';

      if (result.valid) {
        const message = `資格確認OK: ${payer}${copay}`;
        setQualificationCheckMessage({
          tone: warnings.length > 0 ? 'warning' : 'success',
          text: warnings.length > 0 ? `${message}（${warnings.join(' / ')}）` : message,
        });
        toast.success(message);
        return;
      }

      const message =
        warnings.length > 0
          ? `資格確認: 要確認（${warnings.join(' / ')}）`
          : '資格確認: 保険資格が無効または期限切れです';
      setQualificationCheckMessage({ tone: 'warning', text: message });
      toast.error(message);
    } catch (err) {
      const message = messageFromError(err, '資格確認に失敗しました');
      setQualificationCheckMessage({ tone: 'error', text: message });
      toast.error(message);
    } finally {
      setQualificationCheckPending(false);
    }
  }

  return (
    <FormProvider {...form}>
      <form
        ref={formRef}
        onSubmit={handleSubmit(onSubmit, handleInvalidSubmit)}
        noValidate
        className="space-y-4"
      >
        <FormErrorSummary
          id={errorSummaryId}
          title={errorSummaryTitle}
          items={errorSummaryItems}
          showMessage={false}
          compact
        />

        {patientId && !concurrencyAuthority.selectedCareCase ? (
          <Alert id="patient-care-case-unavailable" variant="default" role="status">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <AlertDescription>
              訪問ケースが選択されていないため、依頼元・ケース固有の受付情報は編集できません。基本情報と訪問希望は保存できます。
            </AlertDescription>
          </Alert>
        ) : null}

        {patientId && concurrencyConflict ? (
          <PatientFormConcurrencyAlert
            conflict={concurrencyConflict}
            refreshAvailable={Boolean(onRefreshConcurrencyAuthority)}
            onRefresh={() => void refreshConcurrencyAuthority()}
            onReconfirm={reconfirmAndRetryPatch}
          />
        ) : null}

        {patientId &&
        !hasPatientEditConcurrencyAuthority(concurrencyAuthority.expectedUpdatedAt) ? (
          <Alert id="patient-revision-unavailable" variant="destructive" role="status">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <AlertDescription>
              更新元の版を確認できません。保存せず、患者情報を再読み込みしてください。
            </AlertDescription>
          </Alert>
        ) : null}

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as PatientFormTab)}>
          <div className="rounded-lg border border-border/70 bg-card p-2">
            <div
              className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1"
              role="status"
              aria-label={`入力ステップ ${currentStepIndex + 1} / ${PATIENT_FORM_TABS.length}`}
            >
              <p className="text-xs font-medium text-muted-foreground">
                ステップ{' '}
                <span className="tabular-nums text-foreground">{currentStepIndex + 1}</span> /{' '}
                {PATIENT_FORM_TABS.length} — {PATIENT_FORM_TABS[currentStepIndex]?.label}
              </p>
              {!patientId && currentStepIndex === 0 ? (
                <span className="text-[12px] font-medium text-state-done">
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

          <PatientFormBasicSection
            careTeamPharmacistsLoadFailed={careTeamPharmacistsLoadFailed}
            careTeamPharmacistsQuery={careTeamPharmacistsQuery}
            careTeamStaffLoadFailed={careTeamStaffLoadFailed}
            careTeamStaffQuery={careTeamStaffQuery}
            careTeamFields={careTeamFields}
          />

          <PatientFormContactSection
            patientId={patientId}
            selectedFacilityId={selectedFacilityId}
            facilitiesQuery={facilitiesQuery}
            facilityUnitsQuery={facilityUnitsQuery}
            facilityUnitsLoadFailed={facilityUnitsLoadFailed}
            serviceAreasQuery={serviceAreasQuery}
            serviceAreasLoadFailed={serviceAreasLoadFailed}
            serviceAreaWarning={serviceAreaWarning}
            qualificationCheckPending={qualificationCheckPending}
            qualificationCheckMessage={qualificationCheckMessage}
            onQualificationCheck={() => void handleQualificationCheck()}
            watchedBillingSupportFlag={watchedBillingSupportFlag}
          />

          <PatientFormRequesterSection
            patientId={patientId}
            selectedCareCase={concurrencyAuthority.selectedCareCase}
          />

          <PatientFormVisitSection />

          <PatientFormCareSection
            caseOwnedFieldsDisabled={Boolean(patientId && !concurrencyAuthority.selectedCareCase)}
          />

          <PatientFormTeamSection />
        </Tabs>

        <PatientFormActions
          activeDuplicates={activeDuplicates}
          duplicateConfirmed={duplicateConfirmed}
          onOpenDuplicate={(duplicatePatientId) => {
            allowNavigation();
            router.push(buildPatientHref(duplicatePatientId));
          }}
          onConfirmDuplicate={() => setDuplicateConfirmedKey(duplicateLookupKey)}
          currentStepIndex={currentStepIndex}
          stepCount={PATIENT_FORM_TABS.length}
          nextStepLabel={PATIENT_FORM_TABS[currentStepIndex + 1]?.label}
          onPreviousStep={() => goStep(-1)}
          onNextStep={() => goStep(1)}
          onCancel={() => {
            allowNavigation();
            router.back();
          }}
          isSubmitting={isSubmitting}
          patientId={patientId}
          revisionAuthorityAvailable={hasPatientEditConcurrencyAuthority(
            concurrencyAuthority.expectedUpdatedAt,
          )}
        />
      </form>
    </FormProvider>
  );
}
