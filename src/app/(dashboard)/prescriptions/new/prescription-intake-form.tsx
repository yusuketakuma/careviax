'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Plus, Trash2, AlertTriangle, Shield, Camera, Upload, CheckCircle2, ArrowRight, Minus, QrCode, ClipboardCopy } from 'lucide-react';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { PatientMcsSummarySection } from '@/components/patient-mcs/patient-mcs-summary-section';
import { Badge } from '@/components/ui/badge';
import { DrugSuggest, type DrugSelection } from '@/components/features/pharmacy/drug-suggest';
import {
  extractPackagingInstructionTags,
  PACKAGING_INSTRUCTION_TAG_LABELS,
  PACKAGING_METHOD_LABELS,
  parsePackagingMethod,
} from '@/lib/prescription/packaging';
import {
  emptyLine,
  fetchOrgJson,
  INQUIRY_REASON_OPTIONS,
  METHOD_OPTIONS,
  ROUTE_OPTIONS,
  SOURCE_CONFIG,
  SOURCE_LABELS,
} from './prescription-form.shared';
import { getPrescriptionSubmitBlockers } from './prescription-intake-submit';

type PrescriptionLineInput = {
  line_number: number;
  drug_name: string;
  dose: string;
  frequency: string;
  days: number;
  drug_code?: string;
  dosage_form?: string;
  quantity?: number;
  unit?: string;
  is_generic: boolean;
  is_generic_name_prescription?: boolean;
  route?: string;
  dispensing_method?: string;
  start_date?: string;
  end_date?: string;
  packaging_instructions?: string;
  notes?: string;
};

type PatientOption = {
  id: string;
  name: string;
  name_kana: string;
};

type SelectedPatientDetail = {
  id: string;
  name: string;
  name_kana: string;
};

type CaseOption = {
  id: string;
  status: string;
  patient?: {
    residences?: Array<{
      address?: string | null;
    }>;
  };
};

type FacilityBatchEntryDraft = {
  patient_id: string;
  patient_name: string;
  case_id: string;
  case_status: string;
  residence_label: string | null;
  lines: PrescriptionLineInput[];
};

type PreviousPrescriptionLine = {
  id: string;
  drug_name: string;
  drug_code?: string | null;
  dosage_form?: string | null;
  dose: string;
  frequency: string;
  days: number;
  quantity?: number | null;
  unit?: string | null;
  is_generic?: boolean | null;
  packaging_instructions?: string | null;
  notes?: string | null;
  route?: string | null;
  dispensing_method?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

type PreviousPrescriptionIntake = {
  id: string;
  source_type: string;
  prescribed_date: string;
  prescriber_name: string | null;
  split_dispense_total?: number | null;
  split_dispense_current?: number | null;
  split_next_dispense_date?: string | null;
  cycle: { overall_status: string };
  lines: PreviousPrescriptionLine[];
};

type PrescriberInstitutionOption = {
  id: string;
  name: string;
  institution_code: string | null;
  phone: string | null;
  fax: string | null;
};

type GenericCandidate = {
  id: string;
  yj_code: string;
  drug_name: string;
  generic_name: string | null;
  dosage_form: string | null;
  drug_price: number | null;
  unit: string | null;
  is_generic: boolean;
  generic_price_comparison?: {
    standard_name?: string | null;
    dosage_form?: string | null;
    specification?: string | null;
    lowest_price?: string | null;
    add_on_scope?: string | null;
  } | null;
};

function GenericCandidatePanel({
  query,
  enabled,
  onSelect,
}: {
  query: string;
  enabled: boolean;
  onSelect: (candidate: GenericCandidate) => void;
}) {
  const orgId = useOrgId();

  const { data, isLoading } = useQuery({
    queryKey: ['generic-candidates', orgId, query],
    queryFn: async () => {
      const params = new URLSearchParams({
        q: query,
        generic: 'true',
        limit: '5',
      });
      const res = await fetch(`/api/drug-masters?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('後発候補の取得に失敗しました');
      return res.json() as Promise<{ data: GenericCandidate[] }>;
    },
    enabled: !!orgId && enabled && query.trim().length >= 2,
    staleTime: 30_000,
  });

  const candidatesWithPriceDiff = useMemo(
    () =>
      (data?.data ?? []).map((candidate) => {
        const lowestPrice = candidate.generic_price_comparison?.lowest_price
          ? Number(candidate.generic_price_comparison.lowest_price)
          : null;
        const priceDiff =
          candidate.drug_price != null && lowestPrice != null
            ? Number(candidate.drug_price) - lowestPrice
            : null;
        return { ...candidate, _lowestPrice: lowestPrice, _priceDiff: priceDiff };
      }),
    [data?.data]
  );

  if (!enabled) return null;
  if (isLoading) {
    return (
      <div className="rounded-md border border-blue-200 bg-blue-50/60 px-3 py-2 text-xs text-blue-700">
        後発候補を検索中...
      </div>
    );
  }

  if (candidatesWithPriceDiff.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-blue-200 bg-blue-50/30 px-3 py-2 text-xs text-blue-700">
        一般名処方の候補はまだ見つかっていません。薬剤名を一般名で入力すると候補が表示されます。
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-blue-200 bg-blue-50/50 px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
          後発候補
        </p>
        <span className="text-[11px] text-blue-700">
          候補を選ぶと YJ コードを記録します
        </span>
      </div>
      <div className="space-y-2">
        {candidatesWithPriceDiff.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            onClick={() => onSelect(candidate)}
            className="flex w-full items-start justify-between gap-3 rounded-md border border-blue-200 bg-background px-3 py-2 text-left hover:bg-blue-100/40"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{candidate.drug_name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {candidate.dosage_form ?? '剤形未設定'}
                {candidate.generic_name ? ` / 一般名: ${candidate.generic_name}` : ''}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-xs font-medium text-blue-700">
                {candidate.drug_price != null
                  ? `¥${Number(candidate.drug_price).toFixed(1)} / ${candidate.unit ?? '単位'}`
                  : '薬価未設定'}
              </p>
              {candidate._lowestPrice != null ? (
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  同規格最安 ¥{candidate._lowestPrice.toFixed(1)}
                  {candidate._priceDiff != null
                    ? ` / 差額 ${candidate._priceDiff >= 0 ? '+' : ''}¥${candidate._priceDiff.toFixed(1)}`
                    : ''}
                </p>
              ) : null}
              <p className="mt-0.5 text-[11px] text-muted-foreground">{candidate.yj_code}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function PrescriptionIntakeForm() {
  const orgId = useOrgId();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialPatientId = searchParams.get('patient_id') ?? '';
  const initialCaseId = searchParams.get('case_id') ?? '';
  const initialQrDraftId = searchParams.get('qr_draft_id') ?? '';

  // Patient selection state
  const [patientSelection, setPatientSelection] = useState({
    patientSearch: '',
    selectedPatientId: '',
    selectedPatientName: '',
    selectedCaseId: '',
  });
  const { patientSearch, selectedPatientId, selectedPatientName, selectedCaseId } = patientSelection;
  const updatePatientSelection = useCallback(
    (patch: Partial<typeof patientSelection>) =>
      setPatientSelection((prev) => ({ ...prev, ...patch })),
    []
  );

  // Prescription metadata state
  const [prescriptionMeta, setPrescriptionMeta] = useState({
    sourceType: 'paper' as string,
    prescribedDate: format(new Date(), 'yyyy-MM-dd'),
    prescriberName: '',
    selectedPrescriberInstitutionId: '',
    prescriberInstitution: '',
    refillRemainingCount: '0',
    refillNextDispenseDate: '',
    splitDispenseTotal: '',
    splitDispenseCurrent: '',
    splitNextDispenseDate: '',
    prescriptionCategory: 'regular' as 'regular' | 'emergency',
    emergencyCategory: '' as string,
  });
  const {
    sourceType, prescribedDate, prescriberName,
    selectedPrescriberInstitutionId, prescriberInstitution,
    refillRemainingCount, refillNextDispenseDate,
    splitDispenseTotal, splitDispenseCurrent, splitNextDispenseDate,
    prescriptionCategory, emergencyCategory,
  } = prescriptionMeta;
  const updatePrescriptionMeta = useCallback(
    (patch: Partial<typeof prescriptionMeta>) =>
      setPrescriptionMeta((prev) => ({ ...prev, ...patch })),
    []
  );

  // Document state
  const [document, setDocument] = useState({
    originalDocumentUrl: '',
    originalDocumentName: '',
  });
  const { originalDocumentUrl, originalDocumentName } = document;
  const updateDocument = useCallback(
    (patch: Partial<typeof document>) => setDocument((prev) => ({ ...prev, ...patch })),
    []
  );

  // Inquiry state
  const [inquiry, setInquiry] = useState({
    inquiryReason: '',
    inquiryToPhysician: '',
    inquiryContent: '',
    inquiryDueDate: '',
  });
  const { inquiryReason, inquiryToPhysician, inquiryContent, inquiryDueDate } = inquiry;
  const updateInquiry = useCallback(
    (patch: Partial<typeof inquiry>) => setInquiry((prev) => ({ ...prev, ...patch })),
    []
  );

  // Independent UI state
  const [facilityBatchEntries, setFacilityBatchEntries] = useState<FacilityBatchEntryDraft[]>([]);
  const [documentUploading, setDocumentUploading] = useState(false);
  const [lines, setLines] = useState<PrescriptionLineInput[]>([emptyLine()]);
  const [appliedQrDraftId, setAppliedQrDraftId] = useState('');
  const mapQrLineToForm = toFormLineFromQr;
  const hydrateLinesWithPrevious = hydrateLinesFromPrevious;

  const [error, setError] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const submitBlockersId = 'prescription-submit-blockers';

  // Fetch patients for search
  const { data: patientsData } = useQuery({
    queryKey: ['patients-search', orgId, patientSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '10' });
      if (patientSearch) params.set('q', patientSearch);
      return fetchOrgJson<{ data: PatientOption[] }>({
        url: `/api/patients?${params}`,
        orgId,
        errorMessage: '患者検索に失敗しました',
      });
    },
    enabled: !!orgId && patientSearch.length >= 1,
  });

  const { data: selectedPatientData } = useQuery({
    queryKey: ['selected-patient', orgId, selectedPatientId],
    queryFn: async () => {
      const patient = await fetchOrgJson<SelectedPatientDetail>({
        url: `/api/patients/${selectedPatientId}`,
        orgId,
        errorMessage: '患者情報の取得に失敗しました',
      });
      return {
        id: patient.id,
        name: patient.name,
        name_kana: patient.name_kana,
      } satisfies SelectedPatientDetail;
    },
    enabled: !!orgId && !!selectedPatientId && !selectedPatientName,
    staleTime: 30_000,
  });

  // Fetch cases for selected patient
  const { data: casesData } = useQuery({
    queryKey: ['patient-cases', orgId, selectedPatientId],
    queryFn: async () => {
      return fetchOrgJson<{ data: CaseOption[] }>({
        url: `/api/cases?patient_id=${selectedPatientId}&status=active&limit=20`,
        orgId,
        errorMessage: 'ケース取得に失敗しました',
      });
    },
    enabled: !!orgId && !!selectedPatientId,
  });

  const { data: previousPrescriptionsData } = useQuery({
    queryKey: ['patient-prescriptions', orgId, selectedPatientId],
    queryFn: async () => {
      return fetchOrgJson<{ data: PreviousPrescriptionIntake[] }>({
        url: `/api/patients/${selectedPatientId}/prescriptions?limit=5`,
        orgId,
        errorMessage: '過去処方の取得に失敗しました',
      });
    },
    enabled: !!orgId && !!selectedPatientId,
  });
  const latestPreviousIntake = previousPrescriptionsData?.data?.[0] ?? null;

  const { data: qrDraftData } = useQuery({
    queryKey: ['qr-draft-import', orgId, initialQrDraftId],
    queryFn: async () =>
      fetchOrgJson<QrDraftImportData>({
        url: `/api/qr-scan-drafts/${initialQrDraftId}`,
        orgId,
        errorMessage: 'QR下書きの取得に失敗しました',
      }),
    enabled: !!orgId && !!initialQrDraftId,
    staleTime: 30_000,
  });

  const { data: prescriberInstitutionsData } = useQuery({
    queryKey: ['prescriber-institutions', orgId, prescriberInstitution],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (prescriberInstitution.trim()) params.set('q', prescriberInstitution.trim());
      return fetchOrgJson<{ data: PrescriberInstitutionOption[] }>({
        url: `/api/prescriber-institutions?${params.toString()}`,
        orgId,
        errorMessage: '医療機関マスターの取得に失敗しました',
      });
    },
    enabled: !!orgId,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!orgId || selectedPatientId || !initialPatientId) return;
    updatePatientSelection({ selectedPatientId: initialPatientId });
  }, [initialPatientId, orgId, selectedPatientId, updatePatientSelection]);

  useEffect(() => {
    if (!selectedPatientData) return;
    updatePatientSelection({
      selectedPatientName: selectedPatientData.name,
      ...(!patientSearch.trim() ? { patientSearch: `${selectedPatientData.name} (${selectedPatientData.name_kana})` } : {}),
    });
  }, [patientSearch, selectedPatientData, updatePatientSelection]);

  useEffect(() => {
    if (!initialCaseId || !casesData?.data || selectedCaseId) return;
    if (casesData.data.some((candidate) => candidate.id === initialCaseId)) {
      updatePatientSelection({ selectedCaseId: initialCaseId });
    }
  }, [casesData?.data, initialCaseId, selectedCaseId, updatePatientSelection]);

  useEffect(() => {
    if (!qrDraftData || appliedQrDraftId === qrDraftData.id) return;

    const qrLines = (qrDraftData.parsed_data.lines ?? []).map(mapQrLineToForm);
    updatePatientSelection({
      selectedPatientId: qrDraftData.patient_id ?? '',
      selectedPatientName: qrDraftData.parsed_data.patientName ?? '',
      patientSearch:
        qrDraftData.parsed_data.patientName && qrDraftData.parsed_data.patientNameKana
          ? `${qrDraftData.parsed_data.patientName} (${qrDraftData.parsed_data.patientNameKana})`
          : qrDraftData.parsed_data.patientName ?? '',
    });
    updatePrescriptionMeta({
      sourceType: 'qr_scan',
      prescribedDate: qrDraftData.parsed_data.prescriptionDate || format(new Date(), 'yyyy-MM-dd'),
      prescriberName: qrDraftData.parsed_data.prescriberName ?? '',
      selectedPrescriberInstitutionId: qrDraftData.parsed_data.prescriberInstitutionId ?? '',
      prescriberInstitution: qrDraftData.parsed_data.prescriberInstitution ?? '',
    });
    setLines(
      qrLines.length > 0
        ? qrLines.map((line, index) => ({ ...line, line_number: index + 1 }))
        : [emptyLine()]
    );
    updateInquiry({
      inquiryReason: '',
      inquiryToPhysician: '',
      inquiryContent: '',
      inquiryDueDate: '',
    });
    setError(
      qrDraftData.patient_id
        ? null
        : 'QR下書きに患者紐付けがありません。患者・ケースを選択して内容を確認してください'
    );
    setAppliedQrDraftId(qrDraftData.id);
  }, [
    appliedQrDraftId,
    mapQrLineToForm,
    qrDraftData,
    updateInquiry,
    updatePatientSelection,
    updatePrescriptionMeta,
  ]);

  useEffect(() => {
    if (!latestPreviousIntake) return;
    setLines((prev) => hydrateLinesWithPrevious(prev, latestPreviousIntake));
  }, [hydrateLinesWithPrevious, latestPreviousIntake]);

  // Submit prescription
  const submitMutation = useMutation({
    mutationFn: async () => {
      const numberedLines = lines.map((l, i) => ({ ...l, line_number: i + 1 }));
      const res = await fetch('/api/prescription-intakes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({
          case_id: selectedCaseId,
          patient_id: selectedPatientId,
          source_type: sourceType,
          prescribed_date: prescribedDate,
          prescriber_name: prescriberName || undefined,
          prescriber_institution_id: selectedPrescriberInstitutionId || undefined,
          prescriber_institution: prescriberInstitution || undefined,
          original_document_url: originalDocumentUrl || undefined,
          refill_remaining_count:
            sourceType === 'refill' ? Number.parseInt(refillRemainingCount, 10) || 0 : undefined,
          refill_next_dispense_date:
            sourceType === 'refill' && refillNextDispenseDate ? refillNextDispenseDate : undefined,
          split_dispense_total: splitDispenseTotal ? Number.parseInt(splitDispenseTotal, 10) : undefined,
          split_dispense_current: splitDispenseCurrent ? Number.parseInt(splitDispenseCurrent, 10) : undefined,
          split_next_dispense_date: splitNextDispenseDate || undefined,
          prescription_category: prescriptionCategory,
          emergency_category: prescriptionCategory === 'emergency' ? emergencyCategory || undefined : undefined,
          lines: numberedLines,
          inquiry: hasInquiryDraft
            ? {
                reason: inquiryReason,
                inquiry_to_physician: inquiryToPhysician,
                inquiry_content: inquiryContent,
                request_due_date: inquiryDueDate || undefined,
              }
            : undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: '処方受付に失敗しました' }));
        throw new Error(err.message);
      }
      return res.json();
    },
  });

  const submitFacilityBatchMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/prescription-intakes/facility-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({
          source_type: 'facility_batch',
          prescribed_date: prescribedDate,
          prescriber_name: prescriberName || undefined,
          prescriber_institution_id: selectedPrescriberInstitutionId || undefined,
          prescriber_institution: prescriberInstitution || undefined,
          original_document_url: originalDocumentUrl || undefined,
          prescription_category: prescriptionCategory,
          emergency_category:
            prescriptionCategory === 'emergency' ? emergencyCategory || undefined : undefined,
          entries: facilityBatchEntries.map((entry) => ({
            case_id: entry.case_id,
            patient_id: entry.patient_id,
            lines: entry.lines.map((line, index) => ({
              ...line,
              line_number: index + 1,
            })),
          })),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: '施設まとめ処方の登録に失敗しました' }));
        throw new Error(err.message);
      }
      return res.json();
    },
  });

  const addLine = () => {
    setLines((prev) => [...prev, { ...emptyLine(), line_number: prev.length + 1 }]);
  };

  const removeLine = (index: number) => {
    if (lines.length <= 1) return;
    setLines((prev) => prev.filter((_, i) => i !== index));
  };

  const updateLine = (index: number, field: keyof PrescriptionLineInput, value: unknown) => {
    setLines((prev) =>
      prev.map((line, i) => (i === index ? { ...line, [field]: value } : line))
    );
  };

  const uploadPrescriptionDocument = async (file: File) => {
    if (!selectedPatientId) {
      throw new Error('処方箋原本を登録する前に患者を選択してください');
    }

    const presignResponse = await fetch('/api/files/presigned-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
      body: JSON.stringify({
        purpose: 'prescription',
        patient_id: selectedPatientId,
        file_name: file.name,
        mime_type: file.type || 'image/jpeg',
        size_bytes: file.size,
      }),
    });

    const presignJson = await presignResponse.json().catch(() => null);
    if (!presignResponse.ok) {
      throw new Error(presignJson?.message ?? '処方箋原本のアップロードURL取得に失敗しました');
    }

    const uploadResponse = await fetch(presignJson.data.uploadUrl, {
      method: 'PUT',
      headers: presignJson.data.headers,
      body: file,
    });
    if (!uploadResponse.ok) {
      throw new Error('処方箋原本のアップロードに失敗しました');
    }

    const completeResponse = await fetch('/api/files/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
      body: JSON.stringify({
        file_id: presignJson.data.id,
        etag: uploadResponse.headers.get('etag') ?? undefined,
      }),
    });

    const completeJson = await completeResponse.json().catch(() => null);
    if (!completeResponse.ok) {
      throw new Error(completeJson?.message ?? '処方箋原本のアップロード確定に失敗しました');
    }

    return {
      fileId: completeJson.data.id as string,
      fileName: completeJson.data.originalName as string,
  };
};

type QrDraftImportLine = {
  drugName?: string;
  drugCode?: string | null;
  dosageForm?: string | null;
  dose?: string;
  frequency?: string;
  days?: number | null;
  quantity?: number | null;
  unit?: string | null;
  isGeneric?: boolean;
  packagingInstructions?: string | null;
  packagingInstructionTags?: string[];
  route?: string | null;
  dispensingMethod?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  notes?: string | null;
};

type QrDraftImportData = {
  id: string;
  patient_id: string | null;
  parse_errors: Array<{ field?: string; message: string }> | null;
  parsed_data: {
    patientName?: string;
    patientNameKana?: string;
    prescriptionDate?: string;
    prescriberName?: string;
    prescriberInstitution?: string;
    prescriberInstitutionCode?: string;
    prescriberInstitutionId?: string | null;
    isNewInstitution?: boolean;
    lines?: QrDraftImportLine[];
    unmatchedDrugs?: Array<{ lineIndex: number; drugName: string; drugCode: string | null; reason: string }>;
    formularyStatus?: Array<{
      lineIndex: number;
      drugName: string;
      drugCode: string | null;
      inFormulary: boolean;
      preferredGenericName: string | null;
      stockQty: number | null;
    }>;
  };
};

type LineBadgeTone = 'neutral' | 'info' | 'success' | 'warning';

function medicationKey(line: { drug_name: string; drug_code?: string | null }) {
  return line.drug_code?.trim() || line.drug_name.trim();
}

function buildLineBadges(line: {
  frequency?: string | null;
  route?: string | null;
  dispensing_method?: string | null;
  packaging_instructions?: string | null;
  notes?: string | null;
}) {
  const badges: Array<{ label: string; tone: LineBadgeTone }> = [];

  if (line.route === 'external') badges.push({ label: '外用', tone: 'info' });
  if (line.route === 'injection') badges.push({ label: '注射', tone: 'warning' });
  if (/頓服|必要時|疼痛時|不眠時|発熱時|屯用/i.test(line.frequency ?? '')) {
    badges.push({ label: '頓服', tone: 'warning' });
  }

  if (line.dispensing_method === 'unit_dose') {
    badges.push({ label: '一包化', tone: 'success' });
  }
  if (line.dispensing_method === 'crushed') {
    badges.push({ label: '粉砕', tone: 'warning' });
  }

  const parsedPackaging = parsePackagingMethod(line.packaging_instructions);
  if (parsedPackaging.method && parsedPackaging.method !== 'other') {
    badges.push({
      label: PACKAGING_METHOD_LABELS[parsedPackaging.method],
      tone: parsedPackaging.method === 'crush_and_pack' ? 'warning' : 'success',
    });
  }

  const tags = extractPackagingInstructionTags({
    packagingInstructions: line.packaging_instructions,
    notes: line.notes,
    packagingMethod:
      parsedPackaging.method && parsedPackaging.method !== 'other' ? parsedPackaging.method : null,
  });

  for (const tag of tags) {
    if (tag === 'unit_dose') continue;
    badges.push({
      label: PACKAGING_INSTRUCTION_TAG_LABELS[tag],
      tone: tag === 'crush_prohibited' || tag === 'narcotic' ? 'warning' : 'neutral',
    });
  }

  if (/分包しない|一包化しない|PTPのまま|ヒートのまま/i.test(`${line.packaging_instructions ?? ''} ${line.notes ?? ''}`)) {
    badges.push({ label: '分包しない', tone: 'neutral' });
  }

  const seen = new Set<string>();
  return badges.filter((badge) => {
    if (seen.has(badge.label)) return false;
    seen.add(badge.label);
    return true;
  });
}

function badgeClassName(tone: LineBadgeTone) {
  if (tone === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-900';
  if (tone === 'info') return 'border-sky-200 bg-sky-50 text-sky-900';
  return 'border-border/70 bg-background text-muted-foreground';
}

function toFormLineFromPrevious(line: PreviousPrescriptionLine): PrescriptionLineInput {
  return {
    line_number: 1,
    drug_name: line.drug_name,
    drug_code: line.drug_code ?? undefined,
    dosage_form: line.dosage_form ?? undefined,
    dose: line.dose,
    frequency: line.frequency,
    days: line.days,
    quantity: line.quantity ?? undefined,
    unit: line.unit ?? undefined,
    is_generic: Boolean(line.is_generic),
    route: line.route ?? undefined,
    dispensing_method: line.dispensing_method ?? undefined,
    start_date: line.start_date ?? undefined,
    end_date: line.end_date ?? undefined,
    packaging_instructions: line.packaging_instructions ?? undefined,
    notes: line.notes ?? undefined,
  };
}

function toFormLineFromQr(line: QrDraftImportLine): PrescriptionLineInput {
  return {
    line_number: 1,
    drug_name: line.drugName ?? '',
    drug_code: line.drugCode ?? undefined,
    dosage_form: line.dosageForm ?? undefined,
    dose: line.dose ?? '',
    frequency: line.frequency ?? '',
    days: line.days ?? 1,
    quantity: line.quantity ?? undefined,
    unit: line.unit ?? undefined,
    is_generic: Boolean(line.isGeneric),
    route: line.route ?? undefined,
    dispensing_method: line.dispensingMethod ?? undefined,
    start_date: line.startDate ?? undefined,
    end_date: line.endDate ?? undefined,
    packaging_instructions: line.packagingInstructions ?? undefined,
    notes: line.notes ?? undefined,
  };
}

function hydrateLinesFromPrevious(
  targetLines: PrescriptionLineInput[],
  previousIntake: PreviousPrescriptionIntake | null,
) {
  if (!previousIntake) return targetLines;

  const previousByKey = new Map<string, PreviousPrescriptionLine>();
  for (const line of previousIntake.lines) {
    previousByKey.set(medicationKey(line), line);
  }

  return targetLines.map((line, index) => {
    const previous = previousByKey.get(medicationKey(line));
    if (!previous) {
      return { ...line, line_number: index + 1 };
    }

    return {
      ...line,
      line_number: index + 1,
      start_date: line.start_date || previous.start_date || undefined,
      end_date: line.end_date || previous.end_date || undefined,
      route: line.route || previous.route || undefined,
      dispensing_method: line.dispensing_method || previous.dispensing_method || undefined,
      packaging_instructions:
        line.packaging_instructions || previous.packaging_instructions || undefined,
      notes: line.notes || previous.notes || undefined,
      dosage_form: line.dosage_form || previous.dosage_form || undefined,
      quantity: line.quantity ?? previous.quantity ?? undefined,
      unit: line.unit || previous.unit || undefined,
    };
  });
}

  const handlePrescriptionDocument = async (file: File | null) => {
    if (!file) return;

    setError(null);
    setDocumentUploading(true);

    try {
      const uploaded = await uploadPrescriptionDocument(file);
      updateDocument({
        originalDocumentUrl: new URL(`/api/files/${uploaded.fileId}/download`, window.location.origin).toString(),
        originalDocumentName: uploaded.fileName,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '処方箋原本の登録に失敗しました');
    } finally {
      setDocumentUploading(false);
    }
  };

  const resetCurrentPatientDraft = (options?: { keepDocument?: boolean }) => {
    updatePatientSelection({
      patientSearch: '',
      selectedPatientId: '',
      selectedPatientName: '',
      selectedCaseId: '',
    });
    setLines([emptyLine()]);
    updateInquiry({
      inquiryReason: '',
      inquiryToPhysician: '',
      inquiryContent: '',
      inquiryDueDate: '',
    });
    if (!options?.keepDocument) {
      updateDocument({ originalDocumentUrl: '', originalDocumentName: '' });
    }
    setAppliedQrDraftId('');
    setError(null);
  };

  const addCurrentFacilityBatchEntry = () => {
    if (sourceType !== 'facility_batch') return;
    if (!selectedPatientId || !selectedPatientName || !selectedCaseId) {
      setError('施設まとめ処方に追加する患者とケースを選択してください');
      return;
    }

    const emptyLines = lines.filter((line) => !line.drug_name || !line.dose || !line.frequency);
    if (emptyLines.length > 0) {
      setError('施設まとめ処方に追加する前に、現在の患者の処方明細をすべて入力してください');
      return;
    }

    if (lines.some((line) => !line.drug_code?.trim())) {
      setError('施設まとめ処方に追加する前に、薬剤名を候補から選択してください');
      return;
    }

    if (facilityBatchEntries.some((entry) => entry.case_id === selectedCaseId)) {
      setError('このケースはすでに施設まとめ処方に追加されています');
      return;
    }

    const selectedCase = casesData?.data.find((candidate) => candidate.id === selectedCaseId) ?? null;
    setFacilityBatchEntries((prev) => [
      ...prev,
      {
        patient_id: selectedPatientId,
        patient_name: selectedPatientName,
        case_id: selectedCaseId,
        case_status: selectedCase?.status ?? 'active',
        residence_label: selectedCase?.patient?.residences?.[0]?.address ?? null,
        lines: lines.map((line, index) => ({
          ...line,
          line_number: index + 1,
        })),
      },
    ]);
    setError(null);
    resetCurrentPatientDraft({ keepDocument: true });
  };

  const removeFacilityBatchEntry = (caseId: string) => {
    setFacilityBatchEntries((prev) => prev.filter((entry) => entry.case_id !== caseId));
  };

  const applyLatestPreviousPrescription = useCallback(() => {
    if (!latestPreviousIntake) return;
    const hydratedLines = hydrateLinesWithPrevious(
      latestPreviousIntake.lines.map(toFormLineFromPrevious),
      latestPreviousIntake,
    );
    setLines(hydratedLines);
    setError(null);
  }, [hydrateLinesWithPrevious, latestPreviousIntake]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const submitBlockers = getPrescriptionSubmitBlockers({
      sourceType,
      selectedPatientId,
      selectedCaseId,
      prescriptionCategory,
      emergencyCategory,
      lines,
      facilityBatchEntryCount: facilityBatchEntries.length,
      inquiryReason,
      inquiryToPhysician,
      inquiryContent,
    });

    if (sourceType === 'facility_batch') {
      if (submitBlockers.length > 0) {
        setError(submitBlockers[0] ?? '施設まとめ処方の登録条件を確認してください');
        return;
      }

      try {
        await submitFacilityBatchMutation.mutateAsync();
        router.push('/prescriptions');
      } catch (err) {
        setError(err instanceof Error ? err.message : '施設まとめ処方の登録に失敗しました');
      }
      return;
    }

    if (submitBlockers.length > 0) {
      setError(submitBlockers[0] ?? '処方受付の登録条件を確認してください');
      return;
    }

    if (hasInquiryDraft) {
      if (!inquiryReason || !inquiryToPhysician || !inquiryContent) {
        setError('疑義照会を起票する場合は、理由・照会先医師・内容をすべて入力してください');
        return;
      }
    }

    try {
      await submitMutation.mutateAsync();
      router.push('/prescriptions');
    } catch (err) {
      setError(err instanceof Error ? err.message : '処方受付に失敗しました');
    }
  };

  const isSubmitting =
    submitMutation.isPending ||
    submitFacilityBatchMutation.isPending;
  const isPdfDocument = /\.pdf$/i.test(originalDocumentName);
  const prescriberInstitutions = prescriberInstitutionsData?.data ?? [];
  const hasInquiryDraft =
    inquiryReason.trim().length > 0 ||
    inquiryToPhysician.trim().length > 0 ||
    inquiryContent.trim().length > 0;

  const prescriptionDiff = useMemo(() => {
    if (!latestPreviousIntake) return null;

    const currentFilledLines = lines.filter((line) => line.drug_name.trim().length > 0);
    const previousByKey = new Map<string, PreviousPrescriptionLine>();

    for (const line of latestPreviousIntake.lines) {
      const key = line.drug_code?.trim() || line.drug_name.trim();
      previousByKey.set(key, line);
    }

    const added: PrescriptionLineInput[] = [];
    const changed: Array<{
      current: PrescriptionLineInput;
      previous: PreviousPrescriptionLine;
      reasons: string[];
    }> = [];
    const seenKeys = new Set<string>();

    for (const line of currentFilledLines) {
      const key = line.drug_code?.trim() || line.drug_name.trim();
      if (!key) continue;

      const previous = previousByKey.get(key);
      if (!previous) {
        added.push(line);
        continue;
      }

      seenKeys.add(key);

      const reasons: string[] = [];
      if (previous.dose !== line.dose) reasons.push(`用量 ${previous.dose} → ${line.dose}`);
      if (previous.frequency !== line.frequency) reasons.push(`用法 ${previous.frequency} → ${line.frequency}`);
      if (previous.days !== line.days) reasons.push(`日数 ${previous.days}日 → ${line.days}日`);
      if ((previous.start_date ?? '') !== (line.start_date ?? '')) {
        reasons.push(`開始日 ${previous.start_date ?? '未設定'} → ${line.start_date ?? '未設定'}`);
      }
      if ((previous.route ?? '') !== (line.route ?? '')) {
        reasons.push(`投与経路 ${previous.route ?? '未設定'} → ${line.route ?? '未設定'}`);
      }
      if ((previous.dispensing_method ?? '') !== (line.dispensing_method ?? '')) {
        reasons.push(
          `調剤方法 ${previous.dispensing_method ?? '未設定'} → ${line.dispensing_method ?? '未設定'}`
        );
      }
      if ((previous.packaging_instructions ?? '') !== (line.packaging_instructions ?? '')) {
        reasons.push(
          `包装指示 ${previous.packaging_instructions ?? '未設定'} → ${line.packaging_instructions ?? '未設定'}`
        );
      }

      if (reasons.length > 0) {
        changed.push({ current: line, previous, reasons });
      }
    }

    const removed = latestPreviousIntake.lines.filter((line) => {
      const key = line.drug_code?.trim() || line.drug_name.trim();
      return key ? !seenKeys.has(key) && !currentFilledLines.some((current) => {
        const currentKey = current.drug_code?.trim() || current.drug_name.trim();
        return currentKey === key;
      }) : false;
    });

    const unchangedCount =
      currentFilledLines.length - added.length - changed.length;

    return {
      previous: latestPreviousIntake,
      added,
      changed,
      removed,
      unchangedCount: Math.max(unchangedCount, 0),
    };
  }, [latestPreviousIntake, lines]);
  const filledLineCount = lines.filter((line) => line.drug_name.trim().length > 0).length;
  const isPatientReady = Boolean(selectedPatientId && selectedCaseId);
  const isDocumentReady = Boolean(originalDocumentUrl);
  const submitBlockers = useMemo(
    () =>
      getPrescriptionSubmitBlockers({
        sourceType,
        selectedPatientId,
        selectedCaseId,
        prescriptionCategory,
        emergencyCategory,
        lines,
        facilityBatchEntryCount: facilityBatchEntries.length,
        inquiryReason,
        inquiryToPhysician,
        inquiryContent,
      }),
    [
      facilityBatchEntries.length,
      emergencyCategory,
      inquiryContent,
      inquiryReason,
      inquiryToPhysician,
      lines,
      prescriptionCategory,
      selectedCaseId,
      selectedPatientId,
      sourceType,
    ],
  );
  const canSubmit = submitBlockers.length === 0 && !isSubmitting;

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-6"
      data-testid="prescription-intake-form"
      aria-label="処方受付フォーム"
    >
      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <section className="rounded-xl border border-border/70 bg-card/70 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <h2 className="text-sm font-semibold text-foreground">入力の進め方</h2>
            <p className="text-sm text-muted-foreground">
              1. 患者とケースを選ぶ 2. 処方箋情報と原本を確認する 3. 明細を入力する 4. 最後に下部の登録ボタンで受付を確定します。
            </p>
          </div>
          <div className="grid min-w-[220px] gap-2 text-xs text-muted-foreground sm:grid-cols-3">
            <div className="rounded-lg border bg-background px-3 py-2">
              <p className="font-medium text-foreground">患者・ケース</p>
              <p>{isPatientReady ? '選択済み' : '未完了'}</p>
            </div>
            <div className="rounded-lg border bg-background px-3 py-2">
              <p className="font-medium text-foreground">原本登録</p>
              <p>{isDocumentReady ? '登録済み' : '任意'}</p>
            </div>
            <div className="rounded-lg border bg-background px-3 py-2">
              <p className="font-medium text-foreground">明細入力</p>
              <p>{filledLineCount}/{lines.length} 行入力済み</p>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-border/70 bg-card/70 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <h2 className="text-sm font-semibold text-foreground">QR取込と事前共有</h2>
            <p className="text-sm text-muted-foreground">
              電子お薬手帳 QR の取り込み状況、他職種からの共有要点、前回処方の引用をここで確認します。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/qr-scan"
              className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent"
            >
              <QrCode className="size-4" aria-hidden="true" />
              QRスキャン
            </Link>
            <Link
              href="/prescriptions/qr-drafts"
              className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent"
            >
              <QrCode className="size-4" aria-hidden="true" />
              QR下書き一覧
            </Link>
          </div>
        </div>

        {initialQrDraftId ? (
          <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-sky-950">QR下書き取込</p>
                  <Badge variant="outline" className="border-sky-300 bg-background text-sky-900">
                    {appliedQrDraftId ? '取込済み' : '読込中'}
                  </Badge>
                </div>
                <p className="text-xs text-sky-900/80">
                  QR下書き `{initialQrDraftId.slice(0, 8)}` を処方登録フォームへ反映します。
                </p>
                {qrDraftData?.parsed_data.prescriberInstitution ? (
                  <p className="text-xs text-sky-900/80">
                    医療機関: {qrDraftData.parsed_data.prescriberInstitution}
                    {qrDraftData.parsed_data.prescriberInstitutionCode
                      ? ` (${qrDraftData.parsed_data.prescriberInstitutionCode})`
                      : ''}
                    {qrDraftData.parsed_data.isNewInstitution ? ' / 新規候補' : ''}
                  </p>
                ) : null}
              </div>
              {latestPreviousIntake ? (
                <button
                  type="button"
                  onClick={applyLatestPreviousPrescription}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-sky-300 bg-background px-3 text-sm font-medium text-sky-950 hover:bg-sky-100/40"
                >
                  <ClipboardCopy className="size-4" aria-hidden="true" />
                  前回処方を引用
                </button>
              ) : null}
            </div>

            {qrDraftData?.parse_errors?.length ? (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <p className="font-medium">QR解析時の確認事項</p>
                <ul className="mt-1 space-y-1">
                  {qrDraftData.parse_errors.map((item, index) => (
                    <li key={`${item.field ?? 'field'}-${index}`}>
                      {item.field ? `[${item.field}] ` : ''}
                      {item.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {qrDraftData?.parsed_data.unmatchedDrugs?.length ? (
              <div className="mt-3 rounded-md border border-amber-200 bg-background px-3 py-2 text-xs text-foreground">
                <p className="font-medium text-amber-900">薬剤マスター未一致</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {qrDraftData.parsed_data.unmatchedDrugs.map((item) => (
                    <span key={`${item.lineIndex}-${item.drugName}`} className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900">
                      {item.drugName}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {qrDraftData?.parsed_data.formularyStatus?.some((item) => !item.inFormulary || item.preferredGenericName) ? (
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {qrDraftData.parsed_data.formularyStatus
                  .filter((item) => !item.inFormulary || item.preferredGenericName)
                  .map((item) => (
                    <div key={`${item.lineIndex}-${item.drugName}`} className="rounded-md border border-border/70 bg-background px-3 py-2 text-xs">
                      <p className="font-medium text-foreground">{item.drugName}</p>
                      <p className="mt-1 text-muted-foreground">
                        {item.inFormulary ? '採用薬' : '採用外'}
                        {item.preferredGenericName ? ` / 推奨後発: ${item.preferredGenericName}` : ''}
                        {item.stockQty != null ? ` / 在庫 ${item.stockQty}` : ''}
                      </p>
                    </div>
                  ))}
              </div>
            ) : null}
          </div>
        ) : latestPreviousIntake ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">前回処方を引用</p>
              <p className="text-xs text-muted-foreground">
                直近処方の明細、包装指示、開始日を現在の入力へ反映できます。
              </p>
            </div>
            <button
              type="button"
              onClick={applyLatestPreviousPrescription}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent"
            >
              <ClipboardCopy className="size-4" aria-hidden="true" />
              前回処方を引用
            </button>
          </div>
        ) : null}

        {selectedPatientId ? (
          <PatientMcsSummarySection
            patientId={selectedPatientId}
            title="他職種AI要約"
            description="看護師、ケアマネ、他職種の共有から、処方確認前に押さえるべき点を短く整理します。"
            compact
          />
        ) : (
          <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
            患者を選択すると、他職種からの共有要点を AI 要約で表示します。
          </div>
        )}
      </section>

      {/* Patient Search */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-foreground">患者・ケース</legend>

        <div>
          <label htmlFor="patient-search" className="mb-1 block text-sm font-medium">
            患者検索
          </label>
          <input
            id="patient-search"
            type="text"
              value={patientSearch}
              onChange={(e) => {
                const keepDocument = sourceType === 'facility_batch';
                updatePatientSelection({
                  patientSearch: e.target.value,
                  selectedPatientId: '',
                  selectedPatientName: '',
                  selectedCaseId: '',
                });
                setLines([emptyLine()]);
                setAppliedQrDraftId('');
                updateInquiry({
                  inquiryReason: '',
                  inquiryToPhysician: '',
                  inquiryContent: '',
                  inquiryDueDate: '',
                });
                setError(null);
                if (!keepDocument) {
                  updateDocument({ originalDocumentUrl: '', originalDocumentName: '' });
                }
              }}
            placeholder="氏名またはフリガナで検索"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
          {patientsData?.data && patientsData.data.length > 0 && !selectedPatientId && (
            <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border bg-popover text-sm shadow-md">
              {patientsData.data.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      const keepDocument = sourceType === 'facility_batch';
                      updatePatientSelection({
                        selectedPatientId: p.id,
                        selectedPatientName: p.name,
                        patientSearch: `${p.name} (${p.name_kana})`,
                        selectedCaseId: '',
                      });
                      setLines([emptyLine()]);
                      setAppliedQrDraftId('');
                      updateInquiry({
                        inquiryReason: '',
                        inquiryToPhysician: '',
                        inquiryContent: '',
                        inquiryDueDate: '',
                      });
                      setError(null);
                      if (!keepDocument) {
                        updateDocument({ originalDocumentUrl: '', originalDocumentName: '' });
                      }
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-accent"
                  >
                    {p.name}
                    <span className="ml-1 text-muted-foreground">({p.name_kana})</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {selectedPatientId && casesData?.data && (
          <div>
            <label htmlFor="case-select" className="mb-1 block text-sm font-medium">
              ケース
            </label>
            <select
              id="case-select"
              value={selectedCaseId}
              onChange={(e) => updatePatientSelection({ selectedCaseId: e.target.value })}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">ケースを選択</option>
              {casesData.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id.slice(-8)} — {c.status}
                </option>
              ))}
            </select>
          </div>
        )}
      </fieldset>

      {/* Prescription Info */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-foreground">処方箋情報</legend>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="source-type" className="mb-1 block text-sm font-medium">
              ソースタイプ
            </label>
            <select
              id="source-type"
              data-testid="prescription-source-type"
              value={sourceType}
              onChange={(e) => updatePrescriptionMeta({ sourceType: e.target.value })}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {SOURCE_CONFIG.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="prescribed-date" className="mb-1 block text-sm font-medium">
              処方日
            </label>
            <input
              id="prescribed-date"
              data-testid="prescription-prescribed-date"
              type="date"
              value={prescribedDate}
              onChange={(e) => updatePrescriptionMeta({ prescribedDate: e.target.value })}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="prescription-category" className="mb-1 block text-sm font-medium">
              処方区分
            </label>
            <select
              id="prescription-category"
              data-testid="prescription-category"
              value={prescriptionCategory}
              onChange={(e) => {
                const value = e.target.value as 'regular' | 'emergency';
                updatePrescriptionMeta({
                  prescriptionCategory: value,
                  emergencyCategory: value === 'regular' ? '' : emergencyCategory,
                });
              }}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="regular">定期処方</option>
              <option value="emergency">緊急処方</option>
            </select>
          </div>

          {prescriptionCategory === 'emergency' && (
            <div>
              <label htmlFor="emergency-category" className="mb-1 block text-sm font-medium">
                緊急区分
              </label>
              <select
                id="emergency-category"
                data-testid="emergency-category"
                value={emergencyCategory}
                onChange={(e) => updatePrescriptionMeta({ emergencyCategory: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">選択してください</option>
                <option value="planned_disease_exacerbation">計画的訪問の対象疾患の急変 (500点)</option>
                <option value="other_exacerbation">それ以外の急変 (200点)</option>
                <option value="online">オンライン (59点)</option>
              </select>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="prescriber-name" className="mb-1 block text-sm font-medium">
              処方医名
            </label>
            <input
              id="prescriber-name"
              type="text"
              value={prescriberName}
              onChange={(e) => updatePrescriptionMeta({ prescriberName: e.target.value })}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div>
            <label htmlFor="prescriber-institution-master" className="mb-1 block text-sm font-medium">
              医療機関マスター
            </label>
            <select
              id="prescriber-institution-master"
              value={selectedPrescriberInstitutionId || '__free__'}
              onChange={(e) => {
                const value = e.target.value;
                if (value === '__free__') {
                  updatePrescriptionMeta({ selectedPrescriberInstitutionId: '' });
                  return;
                }
                const selected = prescriberInstitutions.find((item) => item.id === value);
                updatePrescriptionMeta({
                  selectedPrescriberInstitutionId: value,
                  ...(selected ? { prescriberInstitution: selected.name } : {}),
                });
              }}
              className="mb-3 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="__free__">手入力 / 未選択</option>
              {prescriberInstitutions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.institution_code ? ` (${item.institution_code})` : ''}
                </option>
              ))}
            </select>
            <label htmlFor="prescriber-institution" className="mb-1 block text-sm font-medium">
              処方元機関
            </label>
            <input
              id="prescriber-institution"
              type="text"
              value={prescriberInstitution}
              onChange={(e) => {
                const value = e.target.value;
                const matched = prescriberInstitutions.find((item) => item.name === value);
                updatePrescriptionMeta({
                  prescriberInstitution: value,
                  selectedPrescriberInstitutionId: matched?.id ?? '',
                });
              }}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
        </div>

        {sourceType === 'refill' && (
          <div className="grid grid-cols-1 gap-3 rounded-lg border border-amber-200 bg-amber-50/60 p-4 md:grid-cols-2">
            <div className="md:col-span-2 rounded-md border border-amber-200 bg-background/80 px-3 py-2 text-xs leading-5 text-amber-800">
              リフィル処方箋は薬局保管として扱います。次回調剤予定日と残回数を保存し、期限が近づくとダッシュボードと通知で再調剤を案内します。
            </div>
            <div>
              <label htmlFor="refill-remaining-count" className="mb-1 block text-sm font-medium">
                リフィル残回数
              </label>
              <input
                id="refill-remaining-count"
                type="number"
                min={0}
                value={refillRemainingCount}
                onChange={(e) => updatePrescriptionMeta({ refillRemainingCount: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div>
              <label htmlFor="refill-next-dispense-date" className="mb-1 block text-sm font-medium">
                次回調剤予定日
              </label>
              <input
                id="refill-next-dispense-date"
                type="date"
                value={refillNextDispenseDate}
                onChange={(e) => updatePrescriptionMeta({ refillNextDispenseDate: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 rounded-lg border border-border/60 bg-muted/20 p-4 md:grid-cols-3">
          <div>
            <label htmlFor="split-dispense-total" className="mb-1 block text-sm font-medium">
              分割調剤回数
            </label>
            <input
              id="split-dispense-total"
              type="number"
              min={1}
              value={splitDispenseTotal}
              onChange={(e) => updatePrescriptionMeta({ splitDispenseTotal: e.target.value })}
              placeholder="例: 3"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div>
            <label htmlFor="split-dispense-current" className="mb-1 block text-sm font-medium">
              今回回数
            </label>
            <input
              id="split-dispense-current"
              type="number"
              min={1}
              value={splitDispenseCurrent}
              onChange={(e) => updatePrescriptionMeta({ splitDispenseCurrent: e.target.value })}
              placeholder="例: 1"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div>
            <label htmlFor="split-next-dispense-date" className="mb-1 block text-sm font-medium">
              次回調剤予定日
            </label>
            <input
              id="split-next-dispense-date"
              type="date"
              value={splitNextDispenseDate}
              onChange={(e) => updatePrescriptionMeta({ splitNextDispenseDate: e.target.value })}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
        </div>

        <div className="space-y-2 rounded-lg border border-dashed border-border/70 bg-muted/20 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">処方箋原本</p>
              <p className="text-xs text-muted-foreground">
                紙/FAX 処方箋は撮影またはファイル選択で原本を登録できます。
              </p>
            </div>
            {!selectedPatientId ? (
              <span className="text-xs text-muted-foreground">患者選択後に利用できます</span>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              className="hidden"
              onChange={(event) => {
                void handlePrescriptionDocument(event.target.files?.[0] ?? null);
                event.target.value = '';
              }}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(event) => {
                void handlePrescriptionDocument(event.target.files?.[0] ?? null);
                event.target.value = '';
              }}
            />

            <button
              type="button"
              disabled={!selectedPatientId || documentUploading}
              onClick={() => cameraInputRef.current?.click()}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Camera className="size-4" aria-hidden="true" />
              {documentUploading ? '撮影を準備中...' : '処方箋を撮影'}
            </button>
            <button
              type="button"
              disabled={!selectedPatientId || documentUploading}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Upload className="size-4" aria-hidden="true" />
              ファイルを選択
            </button>
          </div>

          {originalDocumentUrl ? (
            <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/70 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-emerald-800">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                  <span>{originalDocumentName || '処方箋原本を登録済み'}</span>
                </div>
                <a
                  href={originalDocumentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-medium underline underline-offset-2"
                >
                  原本を別タブで開く
                </a>
              </div>

              <div className="overflow-hidden rounded-md border bg-background">
                {isPdfDocument ? (
                  <iframe
                    src={originalDocumentUrl}
                    title="処方箋原本プレビュー"
                    className="h-72 w-full"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={originalDocumentUrl}
                    alt="処方箋原本プレビュー"
                    className="max-h-80 w-full object-contain"
                  />
                )}
              </div>
            </div>
          ) : null}
        </div>
      </fieldset>

      {/* Prescription Lines */}
      <fieldset className="space-y-3">
        <div className="flex items-center justify-between">
          <legend className="text-sm font-semibold text-foreground">処方明細</legend>
          <button
            type="button"
            onClick={addLine}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-secondary px-2 text-xs font-medium text-secondary-foreground hover:bg-secondary/80"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            行追加
          </button>
        </div>

        <div className="space-y-3">
          {lines.map((line, index) => (
            <div
              key={index}
              className="rounded-lg border bg-card p-3 space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  #{index + 1}
                </span>
                {lines.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLine(index)}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`明細行 ${index + 1} を削除`}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
              {/* Drug warnings from master */}
              {'_narcotic' in line && (line as Record<string, unknown>)._narcotic === true && (
                <div className="flex items-center gap-1 rounded bg-red-50 px-2 py-1 text-xs font-medium text-red-700">
                  <AlertTriangle className="size-3" aria-hidden="true" />
                  麻薬 — 特別管理が必要です
                </div>
              )}
              {'_psychotropic' in line && (line as Record<string, unknown>)._psychotropic === true && (
                <div className="flex items-center gap-1 rounded bg-orange-50 px-2 py-1 text-xs font-medium text-orange-700">
                  <Shield className="size-3" aria-hidden="true" />
                  向精神薬
                </div>
              )}
              {buildLineBadges(line).length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {buildLineBadges(line).map((badge) => (
                    <span
                      key={`${index}-${badge.label}`}
                      className={`rounded-full border px-2 py-1 text-[11px] font-medium ${badgeClassName(badge.tone)}`}
                    >
                      {badge.label}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <DrugSuggest
                  value={line.drug_name}
                  onTextChange={(text) => updateLine(index, 'drug_name', text)}
                  onSelect={(drug: DrugSelection) => {
                    setLines((prev) =>
                      prev.map((l, i) =>
                        i === index
                          ? {
                              ...l,
                              drug_name: drug.drug_name,
                              drug_code: drug.drug_code,
                              dosage_form: drug.dosage_form ?? l.dosage_form,
                              is_generic: drug.is_generic,
                              is_generic_name_prescription: false,
                              route: drug.dosage_form
                                ? /注射|注入/.test(drug.dosage_form) ? 'injection'
                                  : /軟膏|クリーム|貼付|テープ|坐|点眼|点鼻|吸入|ローション|ゲル/.test(drug.dosage_form) ? 'external'
                                  : 'internal'
                                : l.route,
                              _narcotic: drug.is_narcotic,
                              _psychotropic: drug.is_psychotropic,
                              _maxDays: drug.max_administration_days,
                              _price: drug.drug_price,
                            } as PrescriptionLineInput
                          : l
                      )
                    );
                  }}
                  required
                />
                <input
                  type="text"
                  value={line.dose}
                  onChange={(e) => updateLine(index, 'dose', e.target.value)}
                  placeholder="用量 *"
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                  required
                />
                <input
                  type="text"
                  value={line.frequency}
                  onChange={(e) => updateLine(index, 'frequency', e.target.value)}
                  placeholder="用法 *"
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                  required
                />
                <input
                  type="number"
                  value={line.days}
                  onChange={(e) => updateLine(index, 'days', parseInt(e.target.value, 10) || 1)}
                  placeholder="日数 *"
                  min={1}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                  required
                />
              </div>
              {/* Row 2: Route, Method, Dosage Form, Start Date */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <select
                  value={line.route ?? ''}
                  onChange={(e) => updateLine(index, 'route', e.target.value || undefined)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                  aria-label="投与経路"
                >
                  <option value="">投与経路</option>
                  {ROUTE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <select
                  value={line.dispensing_method ?? ''}
                  onChange={(e) => updateLine(index, 'dispensing_method', e.target.value || undefined)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                  aria-label="調剤方法"
                >
                  <option value="">調剤方法</option>
                  {METHOD_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={line.dosage_form ?? ''}
                  onChange={(e) => updateLine(index, 'dosage_form', e.target.value || undefined)}
                  placeholder="剤形（錠剤等）"
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                />
                <input
                  type="date"
                  value={line.start_date ?? ''}
                  onChange={(e) => updateLine(index, 'start_date', e.target.value || undefined)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                  aria-label="服用開始日"
                />
              </div>
              {/* Row 3: Packaging instructions */}
              <input
                type="text"
                value={line.packaging_instructions ?? ''}
                onChange={(e) => updateLine(index, 'packaging_instructions', e.target.value || undefined)}
                placeholder="包装指示（一包化指示、粉砕指示等）"
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
              />
              <input
                type="text"
                value={line.notes ?? ''}
                onChange={(e) => updateLine(index, 'notes', e.target.value || undefined)}
                placeholder="備考（分包しない、PTPのまま、外用部位など）"
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
              />
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={line.is_generic}
                  onChange={(e) => updateLine(index, 'is_generic', e.target.checked)}
                  className="size-3.5 rounded border-input"
                />
                後発医薬品
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={line.is_generic_name_prescription ?? false}
                  onChange={(e) =>
                    updateLine(index, 'is_generic_name_prescription', e.target.checked)
                  }
                  className="size-3.5 rounded border-input"
                />
                一般名処方
              </label>
              <GenericCandidatePanel
                query={line.drug_name}
                enabled={line.is_generic_name_prescription === true}
                onSelect={(candidate) => {
                  setLines((prev) =>
                    prev.map((currentLine, currentIndex) =>
                      currentIndex === index
                        ? {
                            ...currentLine,
                            drug_name: candidate.drug_name,
                            drug_code: candidate.yj_code,
                            dosage_form: candidate.dosage_form ?? currentLine.dosage_form,
                            is_generic: true,
                          }
                        : currentLine
                    )
                  );
                }}
              />
            </div>
          ))}
        </div>
      </fieldset>

      {sourceType === 'facility_batch' && (
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-foreground">施設まとめ処方</legend>

          <div className="space-y-4 rounded-lg border border-sky-200 bg-sky-50/50 p-4">
            <div className="space-y-1">
              <p className="text-sm font-medium text-sky-950">
                施設看護師から受領した処方箋を患者単位へ分離して登録します
              </p>
              <p className="text-xs leading-5 text-sky-900/80">
                処方日・処方医・原本は共通で入力し、患者ごとの明細を一旦リストへ積んでからまとめて MedicationCycle を起票します。
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-sky-200 bg-background/80 px-3 py-3">
              <div className="space-y-1 text-sm">
                <p className="font-medium text-foreground">
                  現在の患者: {selectedPatientName || '未選択'}
                </p>
                <p className="text-xs text-muted-foreground">
                  ケース {selectedCaseId ? `${selectedCaseId.slice(-8)}` : '未選択'} / 明細 {lines.filter((line) => line.drug_name.trim().length > 0).length} 行
                </p>
              </div>
              <button
                type="button"
                onClick={addCurrentFacilityBatchEntry}
                disabled={!selectedCaseId}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-sky-300 bg-sky-100 px-3 text-sm font-medium text-sky-950 hover:bg-sky-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="size-4" aria-hidden="true" />
                一括リストへ追加
              </button>
            </div>

            {facilityBatchEntries.length > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">
                    登録対象 {facilityBatchEntries.length} 名
                  </p>
                  <p className="text-xs text-muted-foreground">
                    2 名以上でまとめて登録できます
                  </p>
                </div>
                <div className="space-y-2">
                  {facilityBatchEntries.map((entry, index) => (
                    <div
                      key={entry.case_id}
                      className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border/70 bg-background px-3 py-3"
                    >
                      <div className="space-y-1 text-sm">
                        <p className="font-medium text-foreground">
                          {index + 1}. {entry.patient_name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          ケース {entry.case_id.slice(-8)} / {entry.case_status} / {entry.lines.length} 行
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {entry.residence_label ?? '住所未設定'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {entry.lines.slice(0, 3).map((line) => line.drug_name).join('、')}
                          {entry.lines.length > 3 ? ` 他${entry.lines.length - 3}剤` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFacilityBatchEntry(entry.case_id)}
                        className="inline-flex h-8 items-center gap-1 rounded-md border border-input bg-background px-2 text-xs font-medium hover:bg-accent"
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                        削除
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                まだ一括リストに患者が追加されていません。患者・ケース・明細を入力して追加してください。
              </p>
            )}
          </div>
        </fieldset>
      )}

      {sourceType !== 'facility_batch' ? (
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-foreground">疑義照会</legend>

          <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-4">
            <p className="text-sm font-medium text-foreground">必要時のみ起票</p>
            <p className="mt-1 text-xs text-muted-foreground">
              入力すると、処方受付の登録直後に疑義照会を起票し、サイクルを `疑義照会中` に遷移させます。
            </p>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label htmlFor="inquiry-reason" className="mb-1 block text-sm font-medium">
                  照会理由
                </label>
                <select
                  id="inquiry-reason"
                  value={inquiryReason}
                  onChange={(e) => updateInquiry({ inquiryReason: e.target.value })}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">照会理由を選択</option>
                  {INQUIRY_REASON_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="inquiry-physician" className="mb-1 block text-sm font-medium">
                  照会先医師
                </label>
                <input
                  id="inquiry-physician"
                  type="text"
                  value={inquiryToPhysician}
                  onChange={(e) => updateInquiry({ inquiryToPhysician: e.target.value })}
                  placeholder="例: 山田 太郎 先生"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>

              <div className="md:col-span-2">
                <label htmlFor="inquiry-content" className="mb-1 block text-sm font-medium">
                  照会内容
                </label>
                <textarea
                  id="inquiry-content"
                  value={inquiryContent}
                  onChange={(e) => updateInquiry({ inquiryContent: e.target.value })}
                  placeholder="疑義照会の内容を入力"
                  className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label htmlFor="inquiry-due-date" className="mb-1 block text-sm font-medium">
                  回答期限
                </label>
                <input
                  id="inquiry-due-date"
                  type="date"
                  value={inquiryDueDate}
                  onChange={(e) => updateInquiry({ inquiryDueDate: e.target.value })}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
            </div>
          </div>
        </fieldset>
      ) : (
        <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          施設まとめ処方では疑義照会を一括起票しません。患者別 MedicationCycle 作成後に、必要な患者だけ個別に起票してください。
        </div>
      )}

      {prescriptionDiff && (
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-foreground">前回処方との差分</legend>

          <div className="rounded-lg border border-border/70 bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  直近処方: {format(new Date(prescriptionDiff.previous.prescribed_date), 'yyyy/MM/dd')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {SOURCE_LABELS[prescriptionDiff.previous.source_type] ?? prescriptionDiff.previous.source_type}
                  {prescriptionDiff.previous.prescriber_name
                    ? ` / ${prescriptionDiff.previous.prescriber_name}`
                    : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-green-100 px-2 py-1 text-green-800">
                  追加 {prescriptionDiff.added.length}
                </span>
                <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-800">
                  変更 {prescriptionDiff.changed.length}
                </span>
                <span className="rounded-full bg-red-100 px-2 py-1 text-red-800">
                  中止 {prescriptionDiff.removed.length}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">
                  同一 {prescriptionDiff.unchangedCount}
                </span>
              </div>
            </div>

            <div className="grid gap-4 px-4 py-4 lg:grid-cols-2">
              <div className="space-y-3">
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    追加
                  </h3>
                  {prescriptionDiff.added.length > 0 ? (
                    <div className="space-y-2">
                      {prescriptionDiff.added.map((line, index) => (
                        <div
                          key={`${line.drug_code ?? line.drug_name}-added-${index}`}
                          className="rounded-md border border-green-200 bg-green-50/60 px-3 py-2 text-sm"
                        >
                          <div className="flex items-center gap-2 font-medium text-green-900">
                            <Plus className="size-4" aria-hidden="true" />
                            {line.drug_name}
                          </div>
                          <p className="mt-1 text-xs text-green-800">
                            {line.dose} / {line.frequency} / {line.days}日分
                          </p>
                          {line.start_date ? (
                            <p className="mt-1 text-[11px] text-green-900/80">開始日 {line.start_date}</p>
                          ) : null}
                          {buildLineBadges(line).length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {buildLineBadges(line).map((badge) => (
                                <span
                                  key={`${line.drug_name}-${badge.label}`}
                                  className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${badgeClassName(badge.tone)}`}
                                >
                                  {badge.label}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">追加薬剤はありません。</p>
                  )}
                </section>

                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    変更
                  </h3>
                  {prescriptionDiff.changed.length > 0 ? (
                    <div className="space-y-2">
                      {prescriptionDiff.changed.map(({ current, reasons }, index) => (
                        <div
                          key={`${current.drug_code ?? current.drug_name}-changed-${index}`}
                          className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm"
                        >
                          <div className="flex items-center gap-2 font-medium text-amber-900">
                            <ArrowRight className="size-4" aria-hidden="true" />
                            {current.drug_name}
                          </div>
                          <ul className="mt-1 space-y-1 text-xs text-amber-800">
                            {reasons.map((reason) => (
                              <li key={reason}>{reason}</li>
                            ))}
                          </ul>
                          {buildLineBadges(current).length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {buildLineBadges(current).map((badge) => (
                                <span
                                  key={`${current.drug_name}-${badge.label}`}
                                  className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${badgeClassName(badge.tone)}`}
                                >
                                  {badge.label}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">変更薬剤はありません。</p>
                  )}
                </section>
              </div>

              <div className="space-y-3">
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    中止
                  </h3>
                  {prescriptionDiff.removed.length > 0 ? (
                    <div className="space-y-2">
                      {prescriptionDiff.removed.map((line) => (
                        <div
                          key={line.id}
                          className="rounded-md border border-red-200 bg-red-50/60 px-3 py-2 text-sm"
                        >
                          <div className="flex items-center gap-2 font-medium text-red-900">
                            <Minus className="size-4" aria-hidden="true" />
                            {line.drug_name}
                          </div>
                          <p className="mt-1 text-xs text-red-800">
                            {line.dose} / {line.frequency} / {line.days}日分
                          </p>
                          {line.start_date ? (
                            <p className="mt-1 text-[11px] text-red-900/80">開始日 {line.start_date}</p>
                          ) : null}
                          {buildLineBadges(line).length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {buildLineBadges(line).map((badge) => (
                                <span
                                  key={`${line.id}-${badge.label}`}
                                  className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${badgeClassName(badge.tone)}`}
                                >
                                  {badge.label}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">中止薬剤はありません。</p>
                  )}
                </section>

                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    前回処方の全体像
                  </h3>
                  <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-3 text-sm">
                    <p className="font-medium text-foreground">
                      {prescriptionDiff.previous.lines.length}剤 / {prescriptionDiff.previous.cycle.overall_status}
                    </p>
                    <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                      {prescriptionDiff.previous.lines.slice(0, 6).map((line) => (
                        <li key={line.id}>
                          {line.drug_name} / {line.dose} / {line.frequency}
                          {line.start_date ? ` / 開始 ${line.start_date}` : ''}
                        </li>
                      ))}
                      {prescriptionDiff.previous.lines.length > 6 && (
                        <li>他 {prescriptionDiff.previous.lines.length - 6} 剤</li>
                      )}
                    </ul>
                  </div>
                </section>
              </div>
            </div>
          </div>
        </fieldset>
      )}

      {/* Submit */}
      <div
        className="rounded-xl border border-primary/20 bg-primary/5 p-4"
        data-testid="prescription-submit-summary"
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">最後にこのボタンで受付を確定します</p>
            <p className="text-sm text-muted-foreground">
              患者・ケースを選択し、必要な明細入力を終えたら登録します。登録後は処方受付一覧へ戻ります。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full border bg-background px-2.5 py-1">
              患者 {selectedPatientName || '未選択'}
            </span>
            <span className="rounded-full border bg-background px-2.5 py-1">
              明細 {filledLineCount} 行
            </span>
            <span className="rounded-full border bg-background px-2.5 py-1">
              原本 {isDocumentReady ? 'あり' : 'なし'}
            </span>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          {submitBlockers.length > 0 ? (
            <div
              id={submitBlockersId}
              className="w-full rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3 sm:flex-1"
              role="status"
            >
              <p className="text-sm font-medium text-amber-950">登録前に必要な確認</p>
              <ul className="mt-2 space-y-1 text-sm text-amber-900">
                {submitBlockers.map((blocker) => (
                  <li key={blocker}>- {blocker}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="w-full rounded-lg border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-900 sm:flex-1">
              登録可能です。内容を確認してから受付を確定してください。
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="submit"
            disabled={!canSubmit}
            data-testid="prescription-submit-primary"
            aria-describedby={submitBlockers.length > 0 ? submitBlockersId : undefined}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isSubmitting
              ? '登録中...'
              : sourceType === 'facility_batch'
                ? '施設まとめ処方を登録'
                : '処方受付を登録'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/prescriptions')}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-input bg-background px-4 text-sm font-medium hover:bg-accent"
          >
            キャンセル
          </button>
        </div>
      </div>
    </form>
  );
}
