'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ActionRail } from '@/components/ui/action-rail';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  APPLICATION_EDITABLE_STATUS_LABELS,
  APPLICATION_STATUS_LABELS,
  CARE_LEVEL_LABELS,
  INSURANCE_TYPE_LABELS,
  formatCareLevel,
  formatCopayRatio,
} from '@/lib/patient/insurance-summary';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { encodePathSegment } from '@/lib/http/path-segment';
import { getPatientCareQueryKeys, invalidateQueryKeys } from '@/lib/visits/query-invalidations';
import { formatDateLabel } from '@/lib/ui/date-format';

type InsuranceRecord = {
  id: string;
  insurance_type: 'medical' | 'care' | 'public_subsidy';
  application_status: 'confirmed' | 'applying' | 'change_pending' | 'not_applicable';
  application_submitted_at: string | null;
  decision_at: string | null;
  public_program_code: string | null;
  previous_care_level: string | null;
  provisional_care_level: string | null;
  confirmed_care_level: string | null;
  insurer_number: string | null;
  symbol: string | null;
  number: string | null;
  branch_number: string | null;
  copay_ratio: number | null;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean;
  notes: string | null;
};

type InsuranceResponse = {
  data: {
    current: InsuranceRecord[];
    upcoming: InsuranceRecord[];
    history: InsuranceRecord[];
    all?: InsuranceRecord[];
  };
};

type InsuranceFormState = {
  insurance_type: InsuranceRecord['insurance_type'];
  application_status: InsuranceRecord['application_status'];
  application_submitted_at: string;
  decision_at: string;
  public_program_code: string;
  previous_care_level: string;
  provisional_care_level: string;
  confirmed_care_level: string;
  insurer_number: string;
  symbol: string;
  number: string;
  branch_number: string;
  copay_ratio: string;
  valid_from: string;
  valid_until: string;
  is_active: boolean;
  notes: string;
};

const EMPTY_FORM: InsuranceFormState = {
  insurance_type: 'medical',
  application_status: 'confirmed',
  application_submitted_at: '',
  decision_at: '',
  public_program_code: '',
  previous_care_level: '',
  provisional_care_level: '',
  confirmed_care_level: '',
  insurer_number: '',
  symbol: '',
  number: '',
  branch_number: '',
  copay_ratio: '',
  valid_from: '',
  valid_until: '',
  is_active: true,
  notes: '',
};

function toDateInputValue(value: string | null) {
  return value ? value.slice(0, 10) : '';
}

function toFormState(record?: InsuranceRecord): InsuranceFormState {
  if (!record) return EMPTY_FORM;

  return {
    insurance_type: record.insurance_type,
    application_status: record.application_status,
    application_submitted_at: toDateInputValue(record.application_submitted_at),
    decision_at: toDateInputValue(record.decision_at),
    public_program_code: record.public_program_code ?? '',
    previous_care_level: record.previous_care_level ?? '',
    provisional_care_level: record.provisional_care_level ?? '',
    confirmed_care_level: record.confirmed_care_level ?? '',
    insurer_number: record.insurer_number ?? '',
    symbol: record.symbol ?? '',
    number: record.number ?? '',
    branch_number: record.branch_number ?? '',
    copay_ratio: record.copay_ratio != null ? String(record.copay_ratio) : '',
    valid_from: toDateInputValue(record.valid_from),
    valid_until: toDateInputValue(record.valid_until),
    is_active: record.is_active,
    notes: record.notes ?? '',
  };
}

function buildInsurancePayload(form: InsuranceFormState) {
  return {
    insurance_type: form.insurance_type,
    application_status: form.application_status,
    application_submitted_at: form.application_submitted_at || null,
    decision_at: form.decision_at || null,
    public_program_code:
      form.insurance_type === 'public_subsidy' ? form.public_program_code || null : null,
    previous_care_level: form.insurance_type === 'care' ? form.previous_care_level || null : null,
    provisional_care_level:
      form.insurance_type === 'care' ? form.provisional_care_level || null : null,
    confirmed_care_level: form.insurance_type === 'care' ? form.confirmed_care_level || null : null,
    insurer_number: form.insurer_number || null,
    symbol: form.symbol || null,
    number: form.number || null,
    branch_number: form.branch_number || null,
    copay_ratio: form.copay_ratio === '' ? null : Number(form.copay_ratio),
    valid_from: form.valid_from || null,
    valid_until: form.valid_until || null,
    is_active: form.is_active,
    notes: form.notes || null,
  };
}

function mergeInsuranceDraft(
  current: Record<string, InsuranceFormState>,
  id: string,
  base: InsuranceFormState,
  patch: Partial<InsuranceFormState>,
) {
  return {
    ...current,
    [id]: {
      ...(current[id] ?? base),
      ...patch,
    },
  };
}

function InsuranceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[120px_minmax(0,1fr)]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{value}</dd>
    </div>
  );
}

function InsuranceEditor({
  title,
  form,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  title: string;
  form: InsuranceFormState;
  onChange: (patch: Partial<InsuranceFormState>) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <div className="space-y-4 rounded-xl border border-border/70 bg-muted/10 p-4">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${title}-insurance-type`}>保険種別</Label>
          <select
            id={`${title}-insurance-type`}
            value={form.insurance_type}
            onChange={(event) =>
              onChange({
                insurance_type: event.target.value as InsuranceRecord['insurance_type'],
              })
            }
            className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {Object.entries(INSURANCE_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${title}-application-status`}>資格状態</Label>
          <select
            id={`${title}-application-status`}
            value={form.application_status}
            onChange={(event) =>
              onChange({
                application_status: event.target.value as InsuranceRecord['application_status'],
              })
            }
            className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {Object.entries(APPLICATION_EDITABLE_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {form.insurance_type === 'public_subsidy' ? (
          <div className="space-y-1.5">
            <Label htmlFor={`${title}-public-program-code`}>公費制度コード</Label>
            <Input
              id={`${title}-public-program-code`}
              inputMode="numeric"
              maxLength={2}
              value={form.public_program_code}
              onChange={(event) => onChange({ public_program_code: event.target.value })}
              placeholder="21 / 54"
            />
          </div>
        ) : null}

        {form.insurance_type === 'care' ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor={`${title}-previous-care-level`}>変更前介護度</Label>
              <select
                id={`${title}-previous-care-level`}
                value={form.previous_care_level}
                onChange={(event) => onChange({ previous_care_level: event.target.value })}
                className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <option value="">未指定</option>
                {Object.entries(CARE_LEVEL_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`${title}-provisional-care-level`}>暫定介護度</Label>
              <select
                id={`${title}-provisional-care-level`}
                value={form.provisional_care_level}
                onChange={(event) => onChange({ provisional_care_level: event.target.value })}
                className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <option value="">未指定</option>
                {Object.entries(CARE_LEVEL_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`${title}-confirmed-care-level`}>確定介護度</Label>
              <select
                id={`${title}-confirmed-care-level`}
                value={form.confirmed_care_level}
                onChange={(event) => onChange({ confirmed_care_level: event.target.value })}
                className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <option value="">未指定</option>
                {Object.entries(CARE_LEVEL_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor={`${title}-copay-ratio`}>自己負担割合</Label>
          <Input
            id={`${title}-copay-ratio`}
            type="number"
            min={0}
            max={100}
            value={form.copay_ratio}
            onChange={(event) => onChange({ copay_ratio: event.target.value })}
            placeholder="30"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${title}-number`}>番号</Label>
          <Input
            id={`${title}-number`}
            value={form.number}
            onChange={(event) => onChange({ number: event.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${title}-symbol`}>記号</Label>
          <Input
            id={`${title}-symbol`}
            value={form.symbol}
            onChange={(event) => onChange({ symbol: event.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${title}-branch-number`}>枝番</Label>
          <Input
            id={`${title}-branch-number`}
            value={form.branch_number}
            onChange={(event) => onChange({ branch_number: event.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${title}-insurer-number`}>保険者番号</Label>
          <Input
            id={`${title}-insurer-number`}
            value={form.insurer_number}
            onChange={(event) => onChange({ insurer_number: event.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${title}-valid-from`}>有効開始日</Label>
          <Input
            id={`${title}-valid-from`}
            type="date"
            value={form.valid_from}
            onChange={(event) => onChange({ valid_from: event.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${title}-valid-until`}>有効終了日</Label>
          <Input
            id={`${title}-valid-until`}
            type="date"
            value={form.valid_until}
            onChange={(event) => onChange({ valid_until: event.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${title}-application-submitted-at`}>申請日</Label>
          <Input
            id={`${title}-application-submitted-at`}
            type="date"
            value={form.application_submitted_at}
            onChange={(event) => onChange({ application_submitted_at: event.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${title}-decision-at`}>決定日</Label>
          <Input
            id={`${title}-decision-at`}
            type="date"
            value={form.decision_at}
            onChange={(event) => onChange({ decision_at: event.target.value })}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${title}-notes`}>備考</Label>
        <Textarea
          id={`${title}-notes`}
          rows={3}
          value={form.notes}
          onChange={(event) => onChange({ notes: event.target.value })}
        />
      </div>

      <label className="flex min-h-10 items-center gap-3 rounded-lg border border-border/70 px-3 py-2 text-sm">
        <Checkbox
          checked={form.is_active}
          onCheckedChange={(checked) => onChange({ is_active: checked === true })}
        />
        <span>この保険を有効として扱う</span>
      </label>

      <ActionRail>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          キャンセル
        </Button>
        <Button type="button" onClick={onSave} disabled={saving}>
          {saving ? '保存中...' : '保存'}
        </Button>
      </ActionRail>
    </div>
  );
}

function insuranceActionLabel(
  sectionTitle: string,
  index: number,
  item: InsuranceRecord,
  action: string,
) {
  return `${sectionTitle} ${index + 1}件目の${INSURANCE_TYPE_LABELS[item.insurance_type]}を${action}`;
}

function InsuranceBlock({
  title,
  items,
  editingId,
  drafts,
  savingId,
  onEdit,
  onDraftChange,
  onSave,
  onDeactivate,
  onDelete,
  onCancel,
}: {
  title: string;
  items: InsuranceRecord[];
  editingId: string | null;
  drafts: Record<string, InsuranceFormState>;
  savingId: string | null;
  onEdit: (item: InsuranceRecord) => void;
  onDraftChange: (id: string, patch: Partial<InsuranceFormState>) => void;
  onSave: (id: string) => void;
  onDeactivate: (item: InsuranceRecord) => void;
  onDelete: (item: InsuranceRecord) => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-border/70 bg-muted/10 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-heading text-sm leading-snug font-medium text-foreground">{title}</h3>
        <Badge variant="outline">{items.length}件</Badge>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">該当する保険情報はありません。</p>
      ) : (
        <div className="space-y-3">
          {items.map((item, index) => {
            const draft = drafts[item.id] ?? toFormState(item);
            const isEditing = editingId === item.id;
            const isSaving = savingId === item.id;

            return (
              <div
                key={item.id}
                className="space-y-3 rounded-lg border border-border/60 bg-background p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{INSURANCE_TYPE_LABELS[item.insurance_type]}</Badge>
                    {!item.is_active ? <Badge variant="outline">無効</Badge> : null}
                  </div>
                  {isEditing ? null : (
                    <ActionRail>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        aria-label={insuranceActionLabel(title, index, item, '編集')}
                        onClick={() => onEdit(item)}
                      >
                        編集
                      </Button>
                      {item.is_active ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          aria-label={insuranceActionLabel(title, index, item, '失効')}
                          onClick={() => onDeactivate(item)}
                        >
                          失効
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          aria-label={insuranceActionLabel(title, index, item, '削除')}
                          onClick={() => onDelete(item)}
                        >
                          削除
                        </Button>
                      )}
                    </ActionRail>
                  )}
                </div>
                <dl className="space-y-2 text-sm">
                  <InsuranceRow label="番号" value={item.number ?? '—'} />
                  <InsuranceRow
                    label="資格状態"
                    value={APPLICATION_STATUS_LABELS[item.application_status]}
                  />
                  <InsuranceRow label="公費制度" value={item.public_program_code ?? '—'} />
                  <InsuranceRow
                    label="介護度"
                    value={[
                      `変更前 ${formatCareLevel(item.previous_care_level)}`,
                      `暫定 ${formatCareLevel(item.provisional_care_level)}`,
                      `確定 ${formatCareLevel(item.confirmed_care_level)}`,
                    ].join(' / ')}
                  />
                  <InsuranceRow
                    label="記号・枝番"
                    value={[item.symbol, item.branch_number].filter(Boolean).join(' / ') || '—'}
                  />
                  <InsuranceRow label="保険者番号" value={item.insurer_number ?? '—'} />
                  <InsuranceRow label="自己負担" value={formatCopayRatio(item.copay_ratio)} />
                  <InsuranceRow
                    label="有効期間"
                    value={`${formatDateLabel(item.valid_from)} - ${formatDateLabel(item.valid_until)}`}
                  />
                  <InsuranceRow
                    label="申請・決定日"
                    value={`${formatDateLabel(item.application_submitted_at)} - ${formatDateLabel(item.decision_at)}`}
                  />
                  <InsuranceRow label="備考" value={item.notes ?? '—'} />
                </dl>
                {isEditing ? (
                  <InsuranceEditor
                    title={`insurance-${item.id}`}
                    form={draft}
                    onChange={(patch) => onDraftChange(item.id, patch)}
                    onSave={() => onSave(item.id)}
                    onCancel={onCancel}
                    saving={isSaving}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function PatientInsuranceCard({ patientId, orgId }: { patientId: string; orgId: string }) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, InsuranceFormState>>({});
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<InsuranceFormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<InsuranceRecord | null>(null);

  const insuranceQuery = useQuery<InsuranceResponse>({
    queryKey: ['patient-insurance', orgId, patientId],
    queryFn: async () => {
      const response = await fetch(`/api/patients/${encodePathSegment(patientId)}/insurance`, {
        headers: buildOrgHeaders(orgId),
      });
      if (!response.ok) throw new Error('患者保険情報の取得に失敗しました');
      return response.json() as Promise<InsuranceResponse>;
    },
    enabled: !!orgId,
  });

  const saveMutation = useMutation({
    mutationFn: async (args: { insuranceId?: string; form: InsuranceFormState }) => {
      const { insuranceId } = args;
      const response = await fetch(
        insuranceId
          ? `/api/patients/${encodePathSegment(patientId)}/insurance/${encodePathSegment(insuranceId)}`
          : `/api/patients/${encodePathSegment(patientId)}/insurance`,
        {
          method: insuranceId ? 'PUT' : 'POST',
          headers: buildOrgJsonHeaders(orgId),
          body: JSON.stringify(buildInsurancePayload(args.form)),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          (payload as { message?: string }).message ?? '患者保険情報の保存に失敗しました',
        );
      }
      return { payload, isUpdate: Boolean(insuranceId) };
    },
    onSuccess: async ({ isUpdate }) => {
      toast.success(isUpdate ? '保険情報を更新しました' : '保険情報を追加しました');
      setEditingId(null);
      setDrafts({});
      setIsCreateOpen(false);
      setCreateDraft(EMPTY_FORM);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['patient-insurance', orgId, patientId],
        }),
        invalidateQueryKeys(queryClient, getPatientCareQueryKeys({ orgId, patientId })),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '患者保険情報の保存に失敗しました');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (insuranceId: string) => {
      const response = await fetch(
        `/api/patients/${encodePathSegment(patientId)}/insurance/${encodePathSegment(insuranceId)}`,
        {
          method: 'DELETE',
          headers: buildOrgHeaders(orgId),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          (payload as { message?: string }).message ?? '保険情報の削除に失敗しました',
        );
      }
      return payload;
    },
    onSuccess: async () => {
      toast.success('保険情報を削除しました');
      setDeleteTarget(null);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['patient-insurance', orgId, patientId],
        }),
        invalidateQueryKeys(queryClient, getPatientCareQueryKeys({ orgId, patientId })),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '保険情報の削除に失敗しました');
    },
  });

  function resetEditor() {
    setEditingId(null);
    setDrafts({});
  }

  function startEdit(item: InsuranceRecord) {
    setIsCreateOpen(false);
    setEditingId(item.id);
    setDrafts((current) => ({
      ...current,
      [item.id]: toFormState(item),
    }));
  }

  function updateDraft(id: string, patch: Partial<InsuranceFormState>) {
    setDrafts((current) => mergeInsuranceDraft(current, id, EMPTY_FORM, patch));
  }

  function saveDraft(id: string) {
    saveMutation.mutate({
      insuranceId: id,
      form: drafts[id] ?? EMPTY_FORM,
    });
  }

  function deactivateInsurance(item: InsuranceRecord) {
    saveMutation.mutate({
      insuranceId: item.id,
      form: {
        ...toFormState(item),
        is_active: false,
      },
    });
  }

  const allInsurances = insuranceQuery.data?.data.all ?? [
    ...(insuranceQuery.data?.data.current ?? []),
    ...(insuranceQuery.data?.data.upcoming ?? []),
    ...(insuranceQuery.data?.data.history ?? []),
  ];

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-heading text-base leading-snug font-medium">保険詳細</h2>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setEditingId(null);
              setDrafts({});
              setIsCreateOpen((current) => !current);
            }}
          >
            {isCreateOpen ? '追加フォームを閉じる' : '保険追加'}
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline">現在有効 {insuranceQuery.data?.data.current.length ?? 0}</Badge>
          <Badge variant="outline">今後有効 {insuranceQuery.data?.data.upcoming.length ?? 0}</Badge>
          <Badge variant="outline">履歴 {insuranceQuery.data?.data.history.length ?? 0}</Badge>
          <Badge variant="outline">総件数 {allInsurances.length}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {insuranceQuery.isLoading ? (
          <div className="h-32 animate-pulse rounded-lg bg-muted" />
        ) : insuranceQuery.error instanceof Error ? (
          <p className="text-sm text-destructive">{insuranceQuery.error.message}</p>
        ) : (
          <>
            {isCreateOpen ? (
              <InsuranceEditor
                title="new-insurance"
                form={createDraft}
                onChange={(patch) =>
                  setCreateDraft((current) => ({
                    ...current,
                    ...patch,
                  }))
                }
                onSave={() => saveMutation.mutate({ form: createDraft })}
                onCancel={() => {
                  setIsCreateOpen(false);
                  setCreateDraft(EMPTY_FORM);
                }}
                saving={saveMutation.isPending && editingId === null}
              />
            ) : null}

            <div className="space-y-4">
              <InsuranceBlock
                title="現在有効"
                items={insuranceQuery.data?.data.current ?? []}
                editingId={editingId}
                drafts={drafts}
                savingId={saveMutation.isPending ? editingId : null}
                onEdit={startEdit}
                onDraftChange={updateDraft}
                onSave={saveDraft}
                onDeactivate={deactivateInsurance}
                onDelete={setDeleteTarget}
                onCancel={resetEditor}
              />

              {(insuranceQuery.data?.data.upcoming.length ?? 0) > 0 ? (
                <InsuranceBlock
                  title="今後有効"
                  items={insuranceQuery.data?.data.upcoming ?? []}
                  editingId={editingId}
                  drafts={drafts}
                  savingId={saveMutation.isPending ? editingId : null}
                  onEdit={startEdit}
                  onDraftChange={updateDraft}
                  onSave={saveDraft}
                  onDeactivate={deactivateInsurance}
                  onDelete={setDeleteTarget}
                  onCancel={resetEditor}
                />
              ) : null}

              {(insuranceQuery.data?.data.history.length ?? 0) > 0 ? (
                <InsuranceBlock
                  title="履歴"
                  items={insuranceQuery.data?.data.history ?? []}
                  editingId={editingId}
                  drafts={drafts}
                  savingId={saveMutation.isPending ? editingId : null}
                  onEdit={startEdit}
                  onDraftChange={updateDraft}
                  onSave={saveDraft}
                  onDeactivate={deactivateInsurance}
                  onDelete={setDeleteTarget}
                  onCancel={resetEditor}
                />
              ) : null}
            </div>
          </>
        )}
      </CardContent>
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="保険情報を削除しますか"
        description="履歴として不要な保険情報を削除します。この操作は元に戻せません。"
        confirmLabel="削除する"
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
        }}
      />
    </Card>
  );
}
