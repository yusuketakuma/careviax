'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import { messageFromError } from '@/lib/utils/error-message';
import { Skeleton } from '@/components/ui/loading';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ActionRail } from '@/components/ui/action-rail';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState } from '@/components/ui/error-state';
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
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { encodePathSegment } from '@/lib/http/path-segment';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { getPatientCareQueryKeys, invalidateQueryKeys } from '@/lib/visits/query-invalidations';
import { formatDateLabel } from '@/lib/ui/date-format';

const nullableIsoDateTimeSchema = z.string().datetime().nullable();

// Keep the client cache bounded to the route projection consumed by this workspace while
// rejecting drift in the envelope and bucket containers.
const insuranceRecordSchema = z.object({
  id: z.string().min(1),
  insurance_type: z.enum(['medical', 'care', 'public_subsidy']),
  application_status: z.enum(['confirmed', 'applying', 'change_pending', 'not_applicable']),
  application_submitted_at: nullableIsoDateTimeSchema,
  decision_at: nullableIsoDateTimeSchema,
  public_program_code: z.string().nullable(),
  previous_care_level: z.string().nullable(),
  provisional_care_level: z.string().nullable(),
  confirmed_care_level: z.string().nullable(),
  insurer_number: z.string().nullable(),
  symbol: z.string().nullable(),
  number: z.string().nullable(),
  branch_number: z.string().nullable(),
  copay_ratio: z.number().int().min(0).max(100).nullable(),
  valid_from: nullableIsoDateTimeSchema,
  valid_until: nullableIsoDateTimeSchema,
  is_active: z.boolean(),
  notes: z.string().nullable(),
  updated_at: z.string().datetime(),
});

const insuranceResponseSchema = z
  .object({
    data: z
      .object({
        current: z.array(insuranceRecordSchema),
        upcoming: z.array(insuranceRecordSchema),
        history: z.array(insuranceRecordSchema),
      })
      .strict(),
  })
  .strict();

type InsuranceRecord = z.infer<typeof insuranceRecordSchema>;
type InsuranceResponse = z.infer<typeof insuranceResponseSchema>;

const OFFICIAL_CARE_LEVEL_VALUES = [
  'support_1',
  'support_2',
  'care_1',
  'care_2',
  'care_3',
  'care_4',
  'care_5',
] as const;

type OfficialCareLevel = (typeof OFFICIAL_CARE_LEVEL_VALUES)[number];

const IDENTIFIER_LABELS = {
  medical: {
    insurerNumber: '保険者番号',
    number: '被保険者等番号',
  },
  care: {
    insurerNumber: '介護保険者番号',
    number: '介護保険被保険者番号',
  },
  public_subsidy: {
    insurerNumber: '公費負担者番号',
    number: '受給者番号',
  },
} as const;

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

type InsuranceFormErrors = Partial<Record<keyof InsuranceFormState, string>>;

type SaveInsuranceArgs =
  | {
      insuranceId: string;
      expectedUpdatedAt: string;
      form: InsuranceFormState;
    }
  | {
      insuranceId?: undefined;
      expectedUpdatedAt?: never;
      form: InsuranceFormState;
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

function isOfficialCareLevel(value: string): value is OfficialCareLevel {
  return OFFICIAL_CARE_LEVEL_VALUES.includes(value as OfficialCareLevel);
}

function validateInsuranceForm(form: InsuranceFormState): InsuranceFormErrors {
  const errors: InsuranceFormErrors = {};

  if (form.insurance_type === 'public_subsidy' && !/^\d{2}$/.test(form.public_program_code)) {
    errors.public_program_code = '公費は2桁の法別番号を入力してください。';
  }

  if (form.is_active && form.insurance_type === 'care' && form.application_status === 'confirmed') {
    if (!isOfficialCareLevel(form.confirmed_care_level)) {
      errors.confirmed_care_level = '確定済みの介護保険は認定区分を選択してください。';
    }
  }

  if (
    form.is_active &&
    form.insurance_type === 'care' &&
    form.application_status === 'change_pending'
  ) {
    if (!isOfficialCareLevel(form.previous_care_level)) {
      errors.previous_care_level = '区分変更前の認定区分を選択してください。';
    }
    if (!isOfficialCareLevel(form.provisional_care_level)) {
      errors.provisional_care_level = '区分変更中の暫定区分を選択してください。';
    }
  }

  if (form.valid_from && form.valid_until && form.valid_from > form.valid_until) {
    errors.valid_until = '有効終了日は有効開始日以降にしてください。';
  }

  if (
    form.application_submitted_at &&
    form.decision_at &&
    form.application_submitted_at > form.decision_at
  ) {
    errors.decision_at = '決定日は申請日以降にしてください。';
  }

  if (form.copay_ratio !== '') {
    const ratio = Number(form.copay_ratio);
    if (!Number.isInteger(ratio) || ratio < 0 || ratio > 100) {
      errors.copay_ratio = '自己負担割合は0〜100の整数で入力してください。';
    }
  }

  return errors;
}

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
  const isConfirmedCare = form.insurance_type === 'care' && form.application_status === 'confirmed';
  const isPendingCareChange =
    form.insurance_type === 'care' && form.application_status === 'change_pending';

  return {
    insurance_type: form.insurance_type,
    application_status: form.application_status,
    application_submitted_at: form.application_submitted_at || null,
    decision_at: form.decision_at || null,
    public_program_code:
      form.insurance_type === 'public_subsidy' ? form.public_program_code || null : null,
    previous_care_level: isPendingCareChange ? form.previous_care_level || null : null,
    provisional_care_level: isPendingCareChange ? form.provisional_care_level || null : null,
    confirmed_care_level: isConfirmedCare ? form.confirmed_care_level || null : null,
    insurer_number: form.insurer_number || null,
    symbol: form.insurance_type === 'medical' ? form.symbol || null : null,
    number: form.number || null,
    branch_number: form.insurance_type === 'medical' ? form.branch_number || null : null,
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

function InsuranceFieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="text-xs text-state-blocked">
      {message}
    </p>
  ) : null;
}

function CareLevelField({
  idPrefix,
  field,
  label,
  value,
  error,
  onChange,
}: {
  idPrefix: string;
  field: 'previous_care_level' | 'provisional_care_level' | 'confirmed_care_level';
  label: string;
  value: string;
  error?: string;
  onChange: (patch: Partial<InsuranceFormState>) => void;
}) {
  const inputId = `${idPrefix}-${field.replaceAll('_', '-')}`;
  const errorId = `${inputId}-error`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={inputId}>{label} *</Label>
      <select
        id={inputId}
        value={value}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange({ [field]: event.target.value })}
        className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <option value="">選択してください</option>
        {OFFICIAL_CARE_LEVEL_VALUES.map((careLevel) => (
          <option key={careLevel} value={careLevel}>
            {CARE_LEVEL_LABELS[careLevel]}
          </option>
        ))}
      </select>
      <InsuranceFieldError id={errorId} message={error} />
    </div>
  );
}

function InsuranceEditor({
  idPrefix,
  title,
  form,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  idPrefix: string;
  title: string;
  form: InsuranceFormState;
  onChange: (patch: Partial<InsuranceFormState>) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const errors = validateInsuranceForm(form);
  const errorMessages = [...new Set(Object.values(errors).filter(Boolean))];
  const identifierLabels = IDENTIFIER_LABELS[form.insurance_type];

  function changeInsuranceType(insuranceType: InsuranceRecord['insurance_type']) {
    onChange({
      insurance_type: insuranceType,
      public_program_code: insuranceType === 'public_subsidy' ? form.public_program_code : '',
      previous_care_level: insuranceType === 'care' ? form.previous_care_level : '',
      provisional_care_level: insuranceType === 'care' ? form.provisional_care_level : '',
      confirmed_care_level: insuranceType === 'care' ? form.confirmed_care_level : '',
      symbol: insuranceType === 'medical' ? form.symbol : '',
      branch_number: insuranceType === 'medical' ? form.branch_number : '',
    });
  }

  function changeApplicationStatus(applicationStatus: InsuranceRecord['application_status']) {
    onChange({
      application_status: applicationStatus,
      confirmed_care_level:
        form.insurance_type === 'care' && applicationStatus === 'confirmed'
          ? form.confirmed_care_level
          : '',
      previous_care_level:
        form.insurance_type === 'care' && applicationStatus === 'change_pending'
          ? form.previous_care_level
          : '',
      provisional_care_level:
        form.insurance_type === 'care' && applicationStatus === 'change_pending'
          ? form.provisional_care_level
          : '',
    });
  }

  return (
    <div className="space-y-4 rounded-xl border border-border/70 bg-muted/10 p-4">
      <div>
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          薬局で資格・請求確認に使う患者単位の情報です。マイナンバーは入力しません。
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-insurance-type`}>保険種別</Label>
          <select
            id={`${idPrefix}-insurance-type`}
            value={form.insurance_type}
            onChange={(event) =>
              changeInsuranceType(event.target.value as InsuranceRecord['insurance_type'])
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
          <Label htmlFor={`${idPrefix}-application-status`}>資格・申請状態</Label>
          <select
            id={`${idPrefix}-application-status`}
            value={form.application_status}
            onChange={(event) =>
              changeApplicationStatus(event.target.value as InsuranceRecord['application_status'])
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
            <Label htmlFor={`${idPrefix}-public-program-code`}>法別番号（公費制度コード） *</Label>
            <Input
              id={`${idPrefix}-public-program-code`}
              inputMode="numeric"
              maxLength={2}
              value={form.public_program_code}
              aria-invalid={Boolean(errors.public_program_code)}
              aria-describedby={
                errors.public_program_code ? `${idPrefix}-public-program-code-error` : undefined
              }
              onChange={(event) => onChange({ public_program_code: event.target.value })}
              placeholder="21 / 54"
            />
            <InsuranceFieldError
              id={`${idPrefix}-public-program-code-error`}
              message={errors.public_program_code}
            />
          </div>
        ) : null}

        {form.insurance_type === 'care' && form.application_status === 'confirmed' ? (
          <CareLevelField
            idPrefix={idPrefix}
            field="confirmed_care_level"
            label="要介護状態区分（確定）"
            value={form.confirmed_care_level}
            error={errors.confirmed_care_level}
            onChange={onChange}
          />
        ) : null}

        {form.insurance_type === 'care' && form.application_status === 'change_pending' ? (
          <>
            <CareLevelField
              idPrefix={idPrefix}
              field="previous_care_level"
              label="変更前の要介護状態区分"
              value={form.previous_care_level}
              error={errors.previous_care_level}
              onChange={onChange}
            />
            <CareLevelField
              idPrefix={idPrefix}
              field="provisional_care_level"
              label="暫定の要介護状態区分"
              value={form.provisional_care_level}
              error={errors.provisional_care_level}
              onChange={onChange}
            />
          </>
        ) : null}

        {form.insurance_type === 'care' && form.application_status === 'applying' ? (
          <p className="rounded-lg border border-border/70 bg-background px-3 py-2 text-xs leading-5 text-muted-foreground md:col-span-2">
            申請中は認定区分を未確定として管理します。認定後に「確定済み」へ変更し、要支援1・2または要介護1〜5を登録してください。
          </p>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-insurer-number`}>{identifierLabels.insurerNumber}</Label>
          <Input
            id={`${idPrefix}-insurer-number`}
            inputMode="numeric"
            maxLength={8}
            value={form.insurer_number}
            onChange={(event) => onChange({ insurer_number: event.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-number`}>{identifierLabels.number}</Label>
          <Input
            id={`${idPrefix}-number`}
            value={form.number}
            onChange={(event) => onChange({ number: event.target.value })}
          />
        </div>

        {form.insurance_type === 'medical' ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-symbol`}>記号</Label>
              <Input
                id={`${idPrefix}-symbol`}
                value={form.symbol}
                onChange={(event) => onChange({ symbol: event.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-branch-number`}>枝番</Label>
              <Input
                id={`${idPrefix}-branch-number`}
                inputMode="numeric"
                maxLength={2}
                value={form.branch_number}
                onChange={(event) => onChange({ branch_number: event.target.value })}
              />
            </div>
          </>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-copay-ratio`}>自己負担割合（%）</Label>
          <Input
            id={`${idPrefix}-copay-ratio`}
            type="number"
            min={0}
            max={100}
            step={1}
            value={form.copay_ratio}
            aria-invalid={Boolean(errors.copay_ratio)}
            aria-describedby={errors.copay_ratio ? `${idPrefix}-copay-ratio-error` : undefined}
            onChange={(event) => onChange({ copay_ratio: event.target.value })}
            placeholder="30"
          />
          <InsuranceFieldError id={`${idPrefix}-copay-ratio-error`} message={errors.copay_ratio} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-valid-from`}>有効開始日</Label>
          <Input
            id={`${idPrefix}-valid-from`}
            type="date"
            value={form.valid_from}
            onChange={(event) => onChange({ valid_from: event.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-valid-until`}>有効終了日</Label>
          <Input
            id={`${idPrefix}-valid-until`}
            type="date"
            value={form.valid_until}
            min={form.valid_from || undefined}
            aria-invalid={Boolean(errors.valid_until)}
            aria-describedby={errors.valid_until ? `${idPrefix}-valid-until-error` : undefined}
            onChange={(event) => onChange({ valid_until: event.target.value })}
          />
          <InsuranceFieldError id={`${idPrefix}-valid-until-error`} message={errors.valid_until} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-application-submitted-at`}>申請日</Label>
          <Input
            id={`${idPrefix}-application-submitted-at`}
            type="date"
            value={form.application_submitted_at}
            onChange={(event) => onChange({ application_submitted_at: event.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-decision-at`}>決定日</Label>
          <Input
            id={`${idPrefix}-decision-at`}
            type="date"
            value={form.decision_at}
            min={form.application_submitted_at || undefined}
            aria-invalid={Boolean(errors.decision_at)}
            aria-describedby={errors.decision_at ? `${idPrefix}-decision-at-error` : undefined}
            onChange={(event) => onChange({ decision_at: event.target.value })}
          />
          <InsuranceFieldError id={`${idPrefix}-decision-at-error`} message={errors.decision_at} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-notes`}>備考</Label>
        <Textarea
          id={`${idPrefix}-notes`}
          rows={3}
          maxLength={500}
          value={form.notes}
          onChange={(event) => onChange({ notes: event.target.value })}
        />
      </div>

      <label className="flex min-h-10 items-center gap-3 rounded-lg border border-border/70 px-3 py-2 text-sm">
        <Checkbox
          checked={form.is_active}
          onCheckedChange={(checked) => onChange({ is_active: checked === true })}
        />
        <span>この資格情報を有効として扱う</span>
      </label>

      {errorMessages.length > 0 ? (
        <div
          role="alert"
          className="rounded-lg border border-state-blocked/30 bg-state-blocked/5 p-3"
        >
          <p className="text-sm font-medium text-state-blocked">保存前に確認してください</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-state-blocked">
            {errorMessages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <ActionRail>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          キャンセル
        </Button>
        <Button type="button" onClick={onSave} disabled={saving || errorMessages.length > 0}>
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

function formatCareClassification(item: InsuranceRecord) {
  if (item.application_status === 'change_pending') {
    return [
      `変更前 ${formatCareLevel(item.previous_care_level)}`,
      `暫定 ${formatCareLevel(item.provisional_care_level)}`,
    ].join(' / ');
  }
  if (item.application_status === 'confirmed') {
    return formatCareLevel(item.confirmed_care_level);
  }
  return item.application_status === 'applying' ? '認定待ち' : '対象外';
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
  onSave: (item: InsuranceRecord) => void;
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
            const identifierLabels = IDENTIFIER_LABELS[item.insurance_type];

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
                  <InsuranceRow
                    label="資格・申請状態"
                    value={APPLICATION_STATUS_LABELS[item.application_status]}
                  />
                  {item.insurance_type === 'public_subsidy' ? (
                    <InsuranceRow
                      label="法別番号（公費制度コード）"
                      value={item.public_program_code ?? '—'}
                    />
                  ) : null}
                  {item.insurance_type === 'care' ? (
                    <InsuranceRow label="要介護状態区分" value={formatCareClassification(item)} />
                  ) : null}
                  <InsuranceRow
                    label={identifierLabels.insurerNumber}
                    value={item.insurer_number ?? '—'}
                  />
                  <InsuranceRow label={identifierLabels.number} value={item.number ?? '—'} />
                  {item.insurance_type === 'medical' ? (
                    <InsuranceRow
                      label="記号・枝番"
                      value={[item.symbol, item.branch_number].filter(Boolean).join(' / ') || '—'}
                    />
                  ) : null}
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
                    idPrefix={`insurance-${item.id}`}
                    title={`${INSURANCE_TYPE_LABELS[item.insurance_type]}を編集`}
                    form={draft}
                    onChange={(patch) => onDraftChange(item.id, patch)}
                    onSave={() => onSave(item)}
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
      const response = await fetch(buildPatientApiPath(patientId, '/insurance'), {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<InsuranceResponse>(response, {
        fallbackMessage: '患者保険情報の取得に失敗しました',
        schema: insuranceResponseSchema,
      });
    },
    enabled: !!orgId,
  });

  const saveMutation = useMutation({
    mutationFn: async (args: SaveInsuranceArgs) => {
      const { insuranceId } = args;
      const basePath = insuranceId
        ? buildPatientApiPath(patientId, `/insurance/${encodePathSegment(insuranceId)}`)
        : buildPatientApiPath(patientId, '/insurance');
      const path = insuranceId
        ? `${basePath}?expected_updated_at=${encodeURIComponent(args.expectedUpdatedAt)}`
        : basePath;
      const response = await fetch(path, {
        method: insuranceId ? 'PUT' : 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify(buildInsurancePayload(args.form)),
      });
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
      toast.error(messageFromError(error, '患者保険情報の保存に失敗しました'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (insurance: { id: string; updated_at: string }) => {
      // Send the last-observed updated_at so the API can refuse a stale delete
      // that would drop a concurrently corrected row (CXR1-CONC02).
      const path = `${buildPatientApiPath(
        patientId,
        `/insurance/${encodePathSegment(insurance.id)}`,
      )}?expected_updated_at=${encodeURIComponent(insurance.updated_at)}`;
      const response = await fetch(path, {
        method: 'DELETE',
        headers: buildOrgHeaders(orgId),
      });
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
      toast.error(messageFromError(error, '保険情報の削除に失敗しました'));
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

  function saveDraft(item: InsuranceRecord) {
    saveMutation.mutate({
      insuranceId: item.id,
      expectedUpdatedAt: item.updated_at,
      form: drafts[item.id] ?? EMPTY_FORM,
    });
  }

  function deactivateInsurance(item: InsuranceRecord) {
    saveMutation.mutate({
      insuranceId: item.id,
      expectedUpdatedAt: item.updated_at,
      form: {
        ...toFormState(item),
        is_active: false,
      },
    });
  }

  const insuranceCount =
    (insuranceQuery.data?.data.current.length ?? 0) +
    (insuranceQuery.data?.data.upcoming.length ?? 0) +
    (insuranceQuery.data?.data.history.length ?? 0);
  const hasInsuranceLoadError = insuranceQuery.error instanceof Error;
  const canManageInsurance = !insuranceQuery.isLoading && !hasInsuranceLoadError;

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-heading text-base leading-snug font-medium">保険・公費管理</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              医療保険、公費、介護保険の資格・申請状態と有効期間を管理します。
            </p>
          </div>
          {canManageInsurance ? (
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
              {isCreateOpen ? '追加フォームを閉じる' : '保険情報を追加'}
            </Button>
          ) : null}
        </div>
        {canManageInsurance ? (
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">
              現在有効 {insuranceQuery.data?.data.current.length ?? 0}
            </Badge>
            <Badge variant="outline">
              今後有効 {insuranceQuery.data?.data.upcoming.length ?? 0}
            </Badge>
            <Badge variant="outline">履歴 {insuranceQuery.data?.data.history.length ?? 0}</Badge>
            <Badge variant="outline">総件数 {insuranceCount}</Badge>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {insuranceQuery.isLoading ? (
          <div role="status" aria-label="保険情報を読み込み中">
            <Skeleton className="h-32 rounded-lg" />
            <span className="sr-only">保険情報を読み込み中...</span>
          </div>
        ) : hasInsuranceLoadError ? (
          <ErrorState
            variant="server"
            title="保険情報を表示できません"
            cause="患者保険情報の取得に失敗しました。"
            nextAction="通信状態を確認して再試行してください。"
            detail="最新状態を確認できるまで追加・更新・削除操作を停止しています。"
            onRetry={() => void insuranceQuery.refetch()}
            retryLabel="保険情報を再取得"
            headingLevel={3}
          />
        ) : (
          <>
            {isCreateOpen ? (
              <InsuranceEditor
                idPrefix="new-insurance"
                title="保険情報を追加"
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
          if (deleteTarget) deleteMutation.mutate(deleteTarget);
        }}
      />
    </Card>
  );
}
