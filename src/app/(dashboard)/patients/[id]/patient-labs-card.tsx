'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { toast } from 'sonner';
import { messageFromError } from '@/lib/utils/error-message';
import { Skeleton } from '@/components/ui/loading';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ActionRail } from '@/components/ui/action-rail';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { encodePathSegment } from '@/lib/http/path-segment';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { buildVisitHref } from '@/lib/visits/navigation';
import { getPatientCareQueryKeys, invalidateQueryKeys } from '@/lib/visits/query-invalidations';

type LabRecord = {
  id: string;
  analyte_code: string;
  measured_at: string;
  value_numeric: number | null;
  value_text: string | null;
  unit: string | null;
  abnormal_flag: string | null;
  reference_low: number | null;
  reference_high: number | null;
  source_type: 'manual' | 'visit_record' | 'import';
  source_visit_record_id: string | null;
  note: string | null;
  created_at: string;
};

type LabsResponse = {
  data: LabRecord[];
};

type LabCreateForm = {
  analyte_code: string;
  measured_at: string;
  value_numeric: string;
  value_text: string;
  unit: string;
  abnormal_flag: string;
  reference_low: string;
  reference_high: string;
  note: string;
};

type LabEditForm = {
  value_numeric: string;
  value_text: string;
  unit: string;
  abnormal_flag: string;
  reference_low: string;
  reference_high: string;
  note: string;
};

const LAB_ANALYTE_OPTIONS = [
  { value: 'wbc', label: 'WBC' },
  { value: 'neut', label: 'Neut' },
  { value: 'hb', label: 'Hb' },
  { value: 'plt', label: 'PLT' },
  { value: 'pt_inr', label: 'PT-INR' },
  { value: 'ast', label: 'AST' },
  { value: 'alt', label: 'ALT' },
  { value: 't_bil', label: 'T-Bil' },
  { value: 'scr', label: 'Scr' },
  { value: 'egfr', label: 'eGFR' },
  { value: 'ck', label: 'CK' },
  { value: 'crp', label: 'CRP' },
  { value: 'k', label: 'K' },
  { value: 'hba1c', label: 'HbA1c' },
  { value: 'tp', label: 'TP' },
  { value: 'alb', label: 'Alb' },
  { value: 'na', label: 'Na' },
  { value: 'cl', label: 'Cl' },
  { value: 'bun', label: 'BUN' },
  { value: 'bnp', label: 'BNP' },
  { value: 'nt_pro_bnp', label: 'NT-proBNP' },
  { value: 'blood_glucose', label: '血糖' },
] as const;

const LAB_ANALYTE_LABELS = Object.fromEntries(
  LAB_ANALYTE_OPTIONS.map((option) => [option.value, option.label]),
) as Record<string, string>;

const EMPTY_CREATE_FORM: LabCreateForm = {
  analyte_code: 'egfr',
  measured_at: '',
  value_numeric: '',
  value_text: '',
  unit: '',
  abnormal_flag: '',
  reference_low: '',
  reference_high: '',
  note: '',
};

function toEditForm(lab: LabRecord): LabEditForm {
  return {
    value_numeric: lab.value_numeric != null ? String(lab.value_numeric) : '',
    value_text: lab.value_text ?? '',
    unit: lab.unit ?? '',
    abnormal_flag: lab.abnormal_flag ?? '',
    reference_low: lab.reference_low != null ? String(lab.reference_low) : '',
    reference_high: lab.reference_high != null ? String(lab.reference_high) : '',
    note: lab.note ?? '',
  };
}

function toOptionalNumber(value: string) {
  if (value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatMeasuredAt(value: string) {
  try {
    return format(new Date(value), 'yyyy/MM/dd HH:mm', { locale: ja });
  } catch {
    return value;
  }
}

function buildCreatePayload(form: LabCreateForm) {
  return {
    analyte_code: form.analyte_code,
    measured_at: new Date(form.measured_at).toISOString(),
    value_numeric: toOptionalNumber(form.value_numeric),
    value_text: form.value_text || undefined,
    unit: form.unit || undefined,
    abnormal_flag: form.abnormal_flag || undefined,
    reference_low: toOptionalNumber(form.reference_low),
    reference_high: toOptionalNumber(form.reference_high),
    source_type: 'manual' as const,
    note: form.note || undefined,
  };
}

function buildEditPayload(form: LabEditForm) {
  return {
    value_numeric: toOptionalNumber(form.value_numeric),
    value_text: form.value_text || undefined,
    unit: form.unit || undefined,
    abnormal_flag: form.abnormal_flag || undefined,
    reference_low: toOptionalNumber(form.reference_low),
    reference_high: toOptionalNumber(form.reference_high),
    note: form.note || undefined,
  };
}

function LabEditor({
  title,
  form,
  onChange,
  onSave,
  onCancel,
  saving,
  isCreate,
}: {
  title: string;
  form: LabCreateForm | LabEditForm;
  onChange: (patch: Partial<LabCreateForm & LabEditForm>) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  isCreate: boolean;
}) {
  return (
    <div className="space-y-4 rounded-xl border border-border/70 bg-muted/10 p-4">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>

      <div className="grid gap-4 md:grid-cols-2">
        {'analyte_code' in form ? (
          <div className="space-y-1.5">
            <Label htmlFor={`${title}-analyte`}>項目</Label>
            <Select
              value={form.analyte_code}
              onValueChange={(value) => {
                if (value !== null) onChange({ analyte_code: value });
              }}
            >
              <SelectTrigger
                id={`${title}-analyte`}
                className="min-h-[44px] w-full sm:min-h-[44px]"
              >
                {/* Base UI は閉じた状態で既定値ラベルを SSR 解決できず生 enum を出すため明示する */}
                <SelectValue>{(value) => LAB_ANALYTE_LABELS[value as string] ?? value}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {LAB_ANALYTE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value} className="min-h-[44px]">
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {'measured_at' in form ? (
          <div className="space-y-1.5">
            <Label htmlFor={`${title}-measured-at`}>測定日時</Label>
            <Input
              id={`${title}-measured-at`}
              type="datetime-local"
              value={form.measured_at}
              onChange={(event) => onChange({ measured_at: event.target.value })}
            />
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor={`${title}-value-numeric`}>数値</Label>
          <Input
            id={`${title}-value-numeric`}
            value={form.value_numeric}
            onChange={(event) => onChange({ value_numeric: event.target.value })}
            placeholder="12.3"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${title}-value-text`}>文字値</Label>
          <Input
            id={`${title}-value-text`}
            value={form.value_text}
            onChange={(event) => onChange({ value_text: event.target.value })}
            placeholder="陰性 / 3+ など"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${title}-unit`}>単位</Label>
          <Input
            id={`${title}-unit`}
            value={form.unit}
            onChange={(event) => onChange({ unit: event.target.value })}
            placeholder="mg/dL"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${title}-flag`}>異常フラグ</Label>
          <Input
            id={`${title}-flag`}
            value={form.abnormal_flag}
            onChange={(event) => onChange({ abnormal_flag: event.target.value })}
            placeholder="H / L / HH / LL / A"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${title}-reference-low`}>基準下限</Label>
          <Input
            id={`${title}-reference-low`}
            value={form.reference_low}
            onChange={(event) => onChange({ reference_low: event.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${title}-reference-high`}>基準上限</Label>
          <Input
            id={`${title}-reference-high`}
            value={form.reference_high}
            onChange={(event) => onChange({ reference_high: event.target.value })}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${title}-note`}>備考</Label>
        <Textarea
          id={`${title}-note`}
          rows={3}
          value={form.note}
          onChange={(event) => onChange({ note: event.target.value })}
        />
      </div>

      <ActionRail>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          キャンセル
        </Button>
        <Button
          type="button"
          onClick={onSave}
          disabled={saving || ('measured_at' in form && !form.measured_at)}
        >
          {saving ? '保存中...' : isCreate ? '登録する' : '更新する'}
        </Button>
      </ActionRail>
    </div>
  );
}

export function PatientLabsCard({ patientId, orgId }: { patientId: string; orgId: string }) {
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<LabCreateForm>(EMPTY_CREATE_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDrafts, setEditDrafts] = useState<Record<string, LabEditForm>>({});

  const labsQuery = useQuery<LabsResponse>({
    queryKey: ['patient-labs', orgId, patientId],
    queryFn: async () => {
      const response = await fetch(`${buildPatientApiPath(patientId, '/labs')}?limit=30`, {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<LabsResponse>(response, '検査値一覧の取得に失敗しました');
    },
    enabled: !!orgId,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(buildPatientApiPath(patientId, '/labs'), {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify(buildCreatePayload(createForm)),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { message?: string }).message ?? '検査値の登録に失敗しました');
      }
      return payload;
    },
    onSuccess: async () => {
      toast.success('検査値を登録しました');
      setCreateForm(EMPTY_CREATE_FORM);
      setIsCreateOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['patient-labs', orgId, patientId] }),
        invalidateQueryKeys(queryClient, getPatientCareQueryKeys({ orgId, patientId })),
      ]);
    },
    onError: (error) => {
      toast.error(messageFromError(error, '検査値の登録に失敗しました'));
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (labId: string) => {
      const response = await fetch(
        buildPatientApiPath(patientId, `/labs/${encodePathSegment(labId)}`),
        {
          method: 'PATCH',
          headers: buildOrgJsonHeaders(orgId),
          body: JSON.stringify(buildEditPayload(editDrafts[labId])),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { message?: string }).message ?? '検査値の更新に失敗しました');
      }
      return payload;
    },
    onSuccess: async () => {
      toast.success('検査値を更新しました');
      setEditingId(null);
      setEditDrafts({});
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['patient-labs', orgId, patientId] }),
        invalidateQueryKeys(queryClient, getPatientCareQueryKeys({ orgId, patientId })),
      ]);
    },
    onError: (error) => {
      toast.error(messageFromError(error, '検査値の更新に失敗しました'));
    },
  });

  const labs = labsQuery.data?.data ?? [];

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-heading text-base leading-snug font-medium">検査値</h2>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setEditingId(null);
              setEditDrafts({});
              setIsCreateOpen((current) => !current);
            }}
          >
            {isCreateOpen ? '入力を閉じる' : '検査値を追加'}
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline">直近 {labs.length}件</Badge>
          <Badge variant="outline">
            異常フラグあり {labs.filter((lab) => Boolean(lab.abnormal_flag)).length}件
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {labsQuery.isLoading ? (
          <div role="status" aria-label="検査値を読み込み中">
            <Skeleton className="h-32 rounded-lg" />
            <span className="sr-only">検査値を読み込み中...</span>
          </div>
        ) : labsQuery.error instanceof Error ? (
          <p role="status" aria-live="polite" className="text-sm text-destructive">
            {labsQuery.error.message}
          </p>
        ) : (
          <>
            {isCreateOpen ? (
              <LabEditor
                title="new-lab"
                form={createForm}
                onChange={(patch) =>
                  setCreateForm((current) => ({
                    ...current,
                    ...patch,
                  }))
                }
                onSave={() => createMutation.mutate()}
                onCancel={() => {
                  setIsCreateOpen(false);
                  setCreateForm(EMPTY_CREATE_FORM);
                }}
                saving={createMutation.isPending}
                isCreate
              />
            ) : null}

            {labs.length === 0 ? (
              <div className="rounded-xl border border-border/70 bg-muted/10 p-4 text-sm text-muted-foreground">
                検査値はまだありません。訪問記録からの連携、またはこの画面からの手入力で登録できます。
              </div>
            ) : (
              <div className="space-y-3">
                {labs.map((lab) => {
                  const isEditing = editingId === lab.id;
                  const draft = editDrafts[lab.id] ?? toEditForm(lab);
                  return (
                    <div
                      key={lab.id}
                      className="space-y-3 rounded-xl border border-border/70 bg-muted/10 p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary">
                            {LAB_ANALYTE_LABELS[lab.analyte_code] ?? lab.analyte_code}
                          </Badge>
                          {lab.abnormal_flag ? (
                            <Badge variant="destructive">{lab.abnormal_flag}</Badge>
                          ) : null}
                          <Badge variant="outline">
                            {lab.source_type === 'manual'
                              ? '手入力'
                              : lab.source_type === 'visit_record'
                                ? '訪問記録'
                                : '取込'}
                          </Badge>
                        </div>
                        {isEditing ? null : (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setIsCreateOpen(false);
                              setEditingId(lab.id);
                              setEditDrafts((current) => ({
                                ...current,
                                [lab.id]: toEditForm(lab),
                              }));
                            }}
                          >
                            補正
                          </Button>
                        )}
                      </div>

                      <dl className="grid gap-2 text-sm sm:grid-cols-2">
                        <div>
                          <dt className="text-muted-foreground">測定日時</dt>
                          <dd className="mt-1 text-foreground">
                            {formatMeasuredAt(lab.measured_at)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">値</dt>
                          <dd className="mt-1 text-foreground">
                            {lab.value_numeric != null
                              ? `${lab.value_numeric}${lab.unit ?? ''}`
                              : (lab.value_text ?? '—')}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">基準範囲</dt>
                          <dd className="mt-1 text-foreground">
                            {lab.reference_low != null || lab.reference_high != null
                              ? `${lab.reference_low ?? '—'} - ${lab.reference_high ?? '—'}`
                              : '—'}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">備考</dt>
                          <dd className="mt-1 text-foreground">{lab.note ?? '—'}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">由来</dt>
                          <dd className="mt-1 text-foreground">
                            {lab.source_type === 'visit_record' && lab.source_visit_record_id ? (
                              <Link
                                href={buildVisitHref(lab.source_visit_record_id)}
                                className="text-primary hover:underline"
                              >
                                訪問記録由来
                              </Link>
                            ) : lab.source_type === 'visit_record' ? (
                              '訪問記録由来'
                            ) : lab.source_type === 'import' ? (
                              '取込'
                            ) : (
                              '手入力'
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">登録日時</dt>
                          <dd className="mt-1 text-foreground">
                            {formatMeasuredAt(lab.created_at)}
                          </dd>
                        </div>
                      </dl>

                      {isEditing ? (
                        <LabEditor
                          title={`lab-${lab.id}`}
                          form={draft}
                          onChange={(patch) =>
                            setEditDrafts((current) => ({
                              ...current,
                              [lab.id]: {
                                ...(current[lab.id] ?? toEditForm(lab)),
                                ...patch,
                              },
                            }))
                          }
                          onSave={() => updateMutation.mutate(lab.id)}
                          onCancel={() => {
                            setEditingId(null);
                            setEditDrafts({});
                          }}
                          saving={updateMutation.isPending}
                          isCreate={false}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
