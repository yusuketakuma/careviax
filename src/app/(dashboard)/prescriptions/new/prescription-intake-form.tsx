'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Plus, Trash2, AlertTriangle, Shield, Camera, Upload, CheckCircle2, ArrowRight, Minus } from 'lucide-react';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { DrugSuggest, type DrugSelection } from '@/components/features/pharmacy/drug-suggest';
import {
  emptyLine,
  fetchOrgJson,
  INQUIRY_REASON_OPTIONS,
  METHOD_OPTIONS,
  ROUTE_OPTIONS,
  SOURCE_CONFIG,
  SOURCE_LABELS,
} from './prescription-form.shared';

type PrescriptionLineInput = {
  line_number: number;
  drug_name: string;
  dose: string;
  frequency: string;
  days: number;
  drug_code?: string;
  dosage_form?: string;
  is_generic: boolean;
  is_generic_name_prescription?: boolean;
  route?: string;
  dispensing_method?: string;
  start_date?: string;
  packaging_instructions?: string;
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
  dose: string;
  frequency: string;
  days: number;
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
  });
  const {
    sourceType, prescribedDate, prescriberName,
    selectedPrescriberInstitutionId, prescriberInstitution,
    refillRemainingCount, refillNextDispenseDate,
    splitDispenseTotal, splitDispenseCurrent, splitNextDispenseDate,
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

  const [error, setError] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  // Create cycle mutation
  const createCycleMutation = useMutation({
    mutationFn: async (caseId: string) => {
      const res = await fetch('/api/medication-cycles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({ case_id: caseId, patient_id: selectedPatientId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'サイクル作成に失敗しました' }));
        throw new Error(err.message);
      }
      return res.json() as Promise<{ id: string }>;
    },
  });

  // Submit prescription
  const submitMutation = useMutation({
    mutationFn: async (cycleId: string) => {
      const numberedLines = lines.map((l, i) => ({ ...l, line_number: i + 1 }));
      const res = await fetch('/api/prescription-intakes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({
          cycle_id: cycleId,
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
          lines: numberedLines,
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

  const createInquiryMutation = useMutation({
    mutationFn: async (cycleId: string) => {
      const res = await fetch('/api/inquiry-records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({
          cycle_id: cycleId,
          reason: inquiryReason,
          inquiry_to_physician: inquiryToPhysician,
          inquiry_content: inquiryContent,
          inquired_at: new Date().toISOString(),
          request_due_date: inquiryDueDate || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: '疑義照会の起票に失敗しました' }));
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

  const resetCurrentPatientDraft = () => {
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
    resetCurrentPatientDraft();
  };

  const removeFacilityBatchEntry = (caseId: string) => {
    setFacilityBatchEntries((prev) => prev.filter((entry) => entry.case_id !== caseId));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (sourceType === 'facility_batch') {
      if (selectedCaseId || selectedPatientId || lines.some((line) => line.drug_name || line.dose || line.frequency)) {
        setError('現在入力中の患者を先に「一括リストへ追加」するか、入力を消してから登録してください');
        return;
      }
      if (facilityBatchEntries.length < 2) {
        setError('施設まとめ処方は2名以上の患者を一括リストへ追加してください');
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

    if (!selectedCaseId) {
      setError('ケースを選択してください');
      return;
    }

    const emptyLines = lines.filter((l) => !l.drug_name || !l.dose || !l.frequency);
    if (emptyLines.length > 0) {
      setError('すべての処方明細行を入力してください');
      return;
    }

    const hasInquiryDraft =
      inquiryReason.trim().length > 0 ||
      inquiryToPhysician.trim().length > 0 ||
      inquiryContent.trim().length > 0;

    if (hasInquiryDraft) {
      if (!inquiryReason || !inquiryToPhysician || !inquiryContent) {
        setError('疑義照会を起票する場合は、理由・照会先医師・内容をすべて入力してください');
        return;
      }
    }

    try {
      // Step 1: Create MedicationCycle
      const cycle = await createCycleMutation.mutateAsync(selectedCaseId);
      // Step 2: Submit prescription intake
      await submitMutation.mutateAsync(cycle.id);
      // Step 3: Optional inquiry creation
      if (hasInquiryDraft) {
        await createInquiryMutation.mutateAsync(cycle.id);
      }
      router.push('/prescriptions');
    } catch (err) {
      setError(err instanceof Error ? err.message : '処方受付に失敗しました');
    }
  };

  const isSubmitting =
    createCycleMutation.isPending ||
    submitMutation.isPending ||
    createInquiryMutation.isPending ||
    submitFacilityBatchMutation.isPending;
  const isPdfDocument = /\.pdf$/i.test(originalDocumentName);
  const latestPreviousIntake = previousPrescriptionsData?.data?.[0] ?? null;
  const prescriberInstitutions = prescriberInstitutionsData?.data ?? [];

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

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

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
              updatePatientSelection({
                patientSearch: e.target.value,
                selectedPatientId: '',
                selectedPatientName: '',
                selectedCaseId: '',
              });
              if (sourceType !== 'facility_batch') {
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
                      updatePatientSelection({
                        selectedPatientId: p.id,
                        selectedPatientName: p.name,
                        patientSearch: `${p.name} (${p.name_kana})`,
                      });
                      if (sourceType !== 'facility_batch') {
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
      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
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
          className="inline-flex h-9 items-center rounded-lg border border-input bg-background px-4 text-sm font-medium hover:bg-accent"
        >
          キャンセル
        </button>
      </div>
    </form>
  );
}
