'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Plus, Trash2, AlertTriangle, Shield } from 'lucide-react';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { DrugSuggest, type DrugSelection } from '@/components/features/pharmacy/drug-suggest';

type PrescriptionLineInput = {
  line_number: number;
  drug_name: string;
  dose: string;
  frequency: string;
  days: number;
  drug_code?: string;
  dosage_form?: string;
  is_generic: boolean;
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

type CaseOption = {
  id: string;
  status: string;
};

const SOURCE_OPTIONS = [
  { value: 'paper', label: '紙処方箋' },
  { value: 'fax', label: 'FAX' },
  { value: 'e_prescription', label: '電子処方箋' },
  { value: 'facility_batch', label: '施設一括' },
  { value: 'refill', label: 'リフィル' },
] as const;

const ROUTE_OPTIONS = [
  { value: 'internal', label: '内服' },
  { value: 'external', label: '外用' },
  { value: 'injection', label: '注射' },
  { value: 'other', label: 'その他' },
] as const;

const METHOD_OPTIONS = [
  { value: 'standard', label: '通常' },
  { value: 'unit_dose', label: '一包化' },
  { value: 'crushed', label: '粉砕' },
  { value: 'other', label: 'その他' },
] as const;

const emptyLine = (): PrescriptionLineInput => ({
  line_number: 1,
  drug_name: '',
  dose: '',
  frequency: '',
  days: 1,
  is_generic: false,
});

export function PrescriptionIntakeForm() {
  const orgId = useOrgId();
  const router = useRouter();

  // Patient search
  const [patientSearch, setPatientSearch] = useState('');
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [selectedCaseId, setSelectedCaseId] = useState('');

  // Form fields
  const [sourceType, setSourceType] = useState<string>('paper');
  const [prescribedDate, setPrescribedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [prescriberName, setPrescriberName] = useState('');
  const [prescriberInstitution, setPrescriberInstitution] = useState('');
  const [lines, setLines] = useState<PrescriptionLineInput[]>([emptyLine()]);

  const [error, setError] = useState<string | null>(null);

  // Fetch patients for search
  const { data: patientsData } = useQuery({
    queryKey: ['patients-search', orgId, patientSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '10' });
      if (patientSearch) params.set('q', patientSearch);
      const res = await fetch(`/api/patients?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('患者検索に失敗しました');
      return res.json() as Promise<{ data: PatientOption[] }>;
    },
    enabled: !!orgId && patientSearch.length >= 1,
  });

  // Fetch cases for selected patient
  const { data: casesData } = useQuery({
    queryKey: ['patient-cases', orgId, selectedPatientId],
    queryFn: async () => {
      const res = await fetch(`/api/cases?patient_id=${selectedPatientId}&status=active&limit=20`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('ケース取得に失敗しました');
      return res.json() as Promise<{ data: CaseOption[] }>;
    },
    enabled: !!orgId && !!selectedPatientId,
  });

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
          prescriber_institution: prescriberInstitution || undefined,
          lines: numberedLines,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: '処方受付に失敗しました' }));
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: () => {
      router.push('/prescriptions');
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedCaseId) {
      setError('ケースを選択してください');
      return;
    }

    const emptyLines = lines.filter((l) => !l.drug_name || !l.dose || !l.frequency);
    if (emptyLines.length > 0) {
      setError('すべての処方明細行を入力してください');
      return;
    }

    try {
      // Step 1: Create MedicationCycle
      const cycle = await createCycleMutation.mutateAsync(selectedCaseId);
      // Step 2: Submit prescription intake
      await submitMutation.mutateAsync(cycle.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '処方受付に失敗しました');
    }
  };

  const isSubmitting = createCycleMutation.isPending || submitMutation.isPending;

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
              setPatientSearch(e.target.value);
              setSelectedPatientId('');
              setSelectedCaseId('');
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
                      setSelectedPatientId(p.id);
                      setPatientSearch(`${p.name} (${p.name_kana})`);
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
              onChange={(e) => setSelectedCaseId(e.target.value)}
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
              onChange={(e) => setSourceType(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {SOURCE_OPTIONS.map((opt) => (
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
              onChange={(e) => setPrescribedDate(e.target.value)}
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
              onChange={(e) => setPrescriberName(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div>
            <label htmlFor="prescriber-institution" className="mb-1 block text-sm font-medium">
              処方元機関
            </label>
            <input
              id="prescriber-institution"
              type="text"
              value={prescriberInstitution}
              onChange={(e) => setPrescriberInstitution(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
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
            </div>
          ))}
        </div>
      </fieldset>

      {/* Submit */}
      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isSubmitting ? '登録中...' : '処方受付を登録'}
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
