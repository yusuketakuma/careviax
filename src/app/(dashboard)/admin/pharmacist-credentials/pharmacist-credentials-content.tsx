'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { zodResolver } from '@hookform/resolvers/zod';
import { differenceInDays, format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { AlertTriangle, Bell, CheckCircle2, XCircle } from 'lucide-react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { ErrorState } from '@/components/ui/error-state';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormErrorSummary } from '@/components/ui/form-error-summary';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { collectFormErrorSummaryItems } from '@/lib/forms/errors';
import { messageFromError } from '@/lib/utils/error-message';
import {
  PHARMACIST_CREDENTIALS_API_PATH,
  buildPharmacistCredentialApiPath,
} from '@/lib/pharmacist-credentials/api-paths';
import { buildPharmacistsApiPath } from '@/lib/pharmacists/api-paths';

type PharmacistCredential = {
  id: string;
  user_id: string;
  user_name: string;
  certification_type: string;
  certification_number: string | null;
  issued_date: string | null;
  expiry_date: string | null;
  tenure_years: number | null;
  weekly_work_hours: number | null;
  consented_patients: Array<{
    id: string;
    name: string;
  }>;
};

type PharmacistOption = {
  id: string;
  name: string;
  site_name: string | null;
  role: string;
};

type PharmacistCredentialListResponse = {
  data: PharmacistCredential[];
  total_count?: number;
  visible_count?: number;
  hidden_count?: number;
  truncated?: boolean;
  count_basis?: 'pharmacist_credentials';
  filters_applied?: Record<string, never>;
  limit?: number;
};

type CredentialForm = {
  user_id: string;
  certification_type: string;
  certification_number: string;
  issued_date: string;
  expiry_date: string;
  tenure_years: string;
  weekly_work_hours: string;
};

const EMPTY_FORM: CredentialForm = {
  user_id: '',
  certification_type: '',
  certification_number: '',
  issued_date: '',
  expiry_date: '',
  tenure_years: '',
  weekly_work_hours: '',
};

const CREDENTIAL_NUMERIC_LIMITS = {
  tenure_years: {
    label: '在籍年数',
    min: 0,
    max: 80,
    step: '0.1',
    help: '0〜80年の数値。空欄は未設定。',
  },
  weekly_work_hours: {
    label: '週勤務時間',
    min: 0,
    max: 168,
    step: '0.5',
    help: '0〜168時間の数値。空欄は未設定。',
  },
} as const;

const PLAIN_DECIMAL_NUMBER_PATTERN = /^\d+(?:\.\d+)?$/;
const CREDENTIAL_SAVE_BLOCKER_ID = 'credential-save-blocker';
const CREDENTIAL_REQUIRED_MESSAGES = {
  user_id: '対象スタッフを選択してください。',
  certification_type: '認定種別を入力してください。',
} as const;

type CredentialNumericField = keyof typeof CREDENTIAL_NUMERIC_LIMITS;
type CredentialFormErrors = Partial<Record<CredentialNumericField | 'expiry_date', string>>;
type CredentialRequiredErrors = Partial<Record<keyof typeof CREDENTIAL_REQUIRED_MESSAGES, string>>;

function ExpiryBadge({ expiryDate }: { expiryDate: string | null }) {
  if (!expiryDate) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const days = differenceInDays(parseISO(expiryDate), new Date());
  const formatted = format(parseISO(expiryDate), 'yyyy/MM/dd', { locale: ja });

  if (days < 0) {
    return (
      <Badge
        variant="outline"
        className="flex w-fit items-center gap-1 border-transparent bg-state-blocked/10 text-xs text-state-blocked"
      >
        <XCircle className="size-3" aria-hidden="true" />
        {formatted}（期限切れ）
      </Badge>
    );
  }
  if (days <= 30) {
    return (
      <Badge
        variant="outline"
        className="flex w-fit items-center gap-1 border-transparent bg-state-blocked/10 text-xs text-state-blocked"
      >
        <Bell className="size-3" aria-hidden="true" />
        {formatted}（残{days}日）
      </Badge>
    );
  }
  if (days <= 90) {
    return (
      <Badge
        variant="outline"
        className="flex w-fit items-center gap-1 border-transparent bg-state-confirm/10 text-xs text-state-confirm"
      >
        <Bell className="size-3" aria-hidden="true" />
        {formatted}（残{days}日）
      </Badge>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs text-state-done">
      <CheckCircle2 className="size-3.5" aria-hidden="true" />
      {formatted}
    </span>
  );
}

function toNullableNumberText(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function descriptionIds(...ids: Array<string | false | null | undefined>) {
  const value = ids.filter(Boolean).join(' ');
  return value || undefined;
}

function validateCredentialNumber(key: CredentialNumericField, value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const limit = CREDENTIAL_NUMERIC_LIMITS[key];
  const parsed = Number(trimmed);
  if (
    !PLAIN_DECIMAL_NUMBER_PATTERN.test(trimmed) ||
    !Number.isFinite(parsed) ||
    parsed < limit.min ||
    parsed > limit.max
  ) {
    return `${limit.label}は${limit.min}〜${limit.max}の数値で入力してください。`;
  }
  return null;
}

function getCredentialFormErrors(form: CredentialForm): CredentialFormErrors {
  const errors: CredentialFormErrors = {};
  if (form.issued_date && form.expiry_date && form.issued_date > form.expiry_date) {
    errors.expiry_date = '有効期限は交付日以降の日付を指定してください。';
  }

  const tenureError = validateCredentialNumber('tenure_years', form.tenure_years);
  if (tenureError) errors.tenure_years = tenureError;

  const weeklyHoursError = validateCredentialNumber('weekly_work_hours', form.weekly_work_hours);
  if (weeklyHoursError) errors.weekly_work_hours = weeklyHoursError;

  return errors;
}

function getCredentialRequiredErrors(form: CredentialForm): CredentialRequiredErrors {
  const errors: CredentialRequiredErrors = {};
  if (!form.user_id) errors.user_id = CREDENTIAL_REQUIRED_MESSAGES.user_id;
  if (!form.certification_type.trim()) {
    errors.certification_type = CREDENTIAL_REQUIRED_MESSAGES.certification_type;
  }
  return errors;
}

function getCredentialSaveBlocker(form: CredentialForm, errors: CredentialFormErrors) {
  const requiredErrors = getCredentialRequiredErrors(form);
  if (requiredErrors.user_id) return requiredErrors.user_id;
  if (requiredErrors.certification_type) return requiredErrors.certification_type;
  return errors.expiry_date ?? errors.tenure_years ?? errors.weekly_work_hours ?? null;
}

const credentialFormSchema = z
  .object({
    user_id: z.string(),
    certification_type: z.string(),
    certification_number: z.string(),
    issued_date: z.string(),
    expiry_date: z.string(),
    tenure_years: z.string(),
    weekly_work_hours: z.string(),
  })
  .superRefine((form, ctx) => {
    const requiredErrors = getCredentialRequiredErrors(form);
    for (const [path, message] of Object.entries(requiredErrors)) {
      if (!message) continue;
      ctx.addIssue({
        code: 'custom',
        path: [path],
        message,
      });
    }

    const errors = getCredentialFormErrors(form);
    for (const [path, message] of Object.entries(errors)) {
      if (!message) continue;
      ctx.addIssue({
        code: 'custom',
        path: [path],
        message,
      });
    }
  });

function buildForm(credential: PharmacistCredential): CredentialForm {
  return {
    user_id: credential.user_id,
    certification_type: credential.certification_type,
    certification_number: credential.certification_number ?? '',
    issued_date: credential.issued_date?.slice(0, 10) ?? '',
    expiry_date: credential.expiry_date?.slice(0, 10) ?? '',
    tenure_years: credential.tenure_years?.toString() ?? '',
    weekly_work_hours: credential.weekly_work_hours?.toString() ?? '',
  };
}

export function PharmacistCredentialsContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editingCredential, setEditingCredential] = useState<PharmacistCredential | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PharmacistCredential | null>(null);
  const errorSummaryId = 'credential-form-error-summary';
  const {
    control,
    formState: { errors },
    getValues,
    handleSubmit,
    register,
    reset,
  } = useForm<CredentialForm>({
    resolver: zodResolver(credentialFormSchema),
    defaultValues: EMPTY_FORM,
  });
  const watchedForm = useWatch({ control });
  const form: CredentialForm = {
    ...EMPTY_FORM,
    ...watchedForm,
  };
  const errorSummaryItems = collectFormErrorSummaryItems(errors, {
    user_id: '対象スタッフ',
    certification_type: '認定種別',
    certification_number: '認定番号',
    issued_date: '交付日',
    expiry_date: '有効期限',
    tenure_years: '在籍年数',
    weekly_work_hours: '週勤務時間',
  });

  function focusErrorSummary() {
    if (typeof document === 'undefined') return;
    document.getElementById(errorSummaryId)?.focus();
  }

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['pharmacist-credentials', orgId],
    queryFn: async () => {
      const response = await fetch(PHARMACIST_CREDENTIALS_API_PATH, {
        headers: buildOrgHeaders(orgId),
      });
      if (!response.ok) throw new Error('薬剤師認定情報の取得に失敗しました');
      return response.json() as Promise<PharmacistCredentialListResponse>;
    },
    enabled: !!orgId,
  });

  const pharmacistsQuery = useQuery({
    queryKey: ['pharmacist-options', orgId],
    queryFn: async () => {
      const response = await fetch(buildPharmacistsApiPath(), {
        headers: buildOrgHeaders(orgId),
      });
      if (!response.ok) throw new Error('スタッフ一覧の取得に失敗しました');
      return response.json() as Promise<{ data: PharmacistOption[] }>;
    },
    enabled: !!orgId,
  });

  const credentials = data?.data ?? [];
  const totalCredentialCount = data?.total_count ?? credentials.length;
  const visibleCredentialCount = data?.visible_count ?? credentials.length;
  const hiddenCredentialCount =
    data?.hidden_count ?? Math.max(totalCredentialCount - credentials.length, 0);
  const credentialsListSummary =
    hiddenCredentialCount > 0 || data?.truncated
      ? `先頭${visibleCredentialCount.toLocaleString()}件を表示 / 他${hiddenCredentialCount.toLocaleString()}件`
      : `登録${totalCredentialCount.toLocaleString()}件`;
  const pharmacistOptions = pharmacistsQuery.data?.data ?? [];
  const formErrors = getCredentialFormErrors(form);
  const saveBlocker = getCredentialSaveBlocker(form, formErrors);

  const alertItems = credentials.filter((credential) => {
    if (!credential.expiry_date) return false;
    return differenceInDays(parseISO(credential.expiry_date), new Date()) <= 90;
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const currentForm = getValues();
      const wasEditing = Boolean(editingCredential);
      const url = editingCredential
        ? buildPharmacistCredentialApiPath(editingCredential.id)
        : PHARMACIST_CREDENTIALS_API_PATH;
      const method = wasEditing ? 'PATCH' : 'POST';
      const response = await fetch(url, {
        method,
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          user_id: currentForm.user_id,
          certification_type: currentForm.certification_type,
          certification_number: currentForm.certification_number || null,
          issued_date: currentForm.issued_date || null,
          expiry_date: currentForm.expiry_date || null,
          tenure_years: toNullableNumberText(currentForm.tenure_years),
          weekly_work_hours: toNullableNumberText(currentForm.weekly_work_hours),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { message?: string }).message ?? '保存に失敗しました');
      }
      return { wasEditing };
    },
    onSuccess: async ({ wasEditing }) => {
      toast.success(wasEditing ? '資格情報を更新しました' : '資格情報を登録しました');
      setFormOpen(false);
      setEditingCredential(null);
      reset(EMPTY_FORM);
      await queryClient.invalidateQueries({ queryKey: ['pharmacist-credentials', orgId] });
    },
    onError: (error) => {
      toast.error(messageFromError(error, '保存に失敗しました'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!deleteTarget) throw new Error('削除対象がありません');
      const response = await fetch(buildPharmacistCredentialApiPath(deleteTarget.id), {
        method: 'DELETE',
        headers: buildOrgHeaders(orgId),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { message?: string }).message ?? '削除に失敗しました');
      }
    },
    onSuccess: async () => {
      toast.success('資格情報を削除しました');
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['pharmacist-credentials', orgId] });
    },
    onError: (error) => {
      toast.error(messageFromError(error, '削除に失敗しました'));
    },
  });

  const columns = useMemo<ColumnDef<PharmacistCredential>[]>(
    () => [
      {
        accessorKey: 'user_name',
        header: '薬剤師名',
        cell: ({ row }) => <span className="text-sm font-medium">{row.original.user_name}</span>,
      },
      {
        accessorKey: 'certification_type',
        header: '研修認定種別',
        cell: ({ row }) => <span className="text-sm">{row.original.certification_type}</span>,
      },
      {
        accessorKey: 'certification_number',
        header: '認定番号',
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {row.original.certification_number ?? '—'}
          </span>
        ),
      },
      {
        accessorKey: 'expiry_date',
        header: '有効期限',
        cell: ({ row }) => <ExpiryBadge expiryDate={row.original.expiry_date} />,
      },
      {
        accessorKey: 'tenure_years',
        header: '在籍年数',
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">
            {row.original.tenure_years != null ? `${row.original.tenure_years.toFixed(1)}年` : '—'}
          </span>
        ),
      },
      {
        accessorKey: 'weekly_work_hours',
        header: '週勤務時間',
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">
            {row.original.weekly_work_hours != null ? `${row.original.weekly_work_hours}時間` : '—'}
          </span>
        ),
      },
      {
        accessorKey: 'consented_patients',
        header: '同意患者',
        cell: ({ row }) => {
          const patients = row.original.consented_patients;
          if (patients.length === 0) {
            return <span className="text-xs text-muted-foreground">—</span>;
          }
          return (
            <div className="flex flex-wrap gap-1">
              <Badge variant="outline">{patients.length}名</Badge>
              {patients.slice(0, 2).map((patient) => (
                <Badge key={patient.id} variant="secondary" className="max-w-36 truncate">
                  {patient.name}
                </Badge>
              ))}
              {patients.length > 2 ? <Badge variant="outline">+{patients.length - 2}</Badge> : null}
            </div>
          );
        },
      },
      {
        id: 'actions',
        header: '操作',
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-2">
            <Button
              className="h-11 min-h-[44px] sm:h-11 sm:min-h-[44px]"
              size="sm"
              variant="outline"
              aria-label={`${row.original.user_name} の ${row.original.certification_type} を編集`}
              onClick={() => {
                setEditingCredential(row.original);
                reset(buildForm(row.original));
                setFormOpen(true);
              }}
            >
              編集
            </Button>
            <Button
              className="h-11 min-h-[44px] sm:h-11 sm:min-h-[44px]"
              size="sm"
              variant="destructive"
              aria-label={`${row.original.user_name} の ${row.original.certification_type} を失効`}
              onClick={() => setDeleteTarget(row.original)}
            >
              失効
            </Button>
          </div>
        ),
      },
    ],
    [reset],
  );

  return (
    <div className="space-y-4 [&_[data-slot=select-trigger]]:sm:h-11 [&_[data-slot=select-trigger]]:sm:min-h-[44px] [&_button]:sm:h-11 [&_button]:sm:min-h-[44px] [&_input]:sm:h-11 [&_input]:sm:min-h-[44px]">
      {alertItems.length > 0 ? (
        <div className="flex items-start gap-3 rounded-md border-l-4 border-border/70 border-l-state-confirm bg-card px-4 py-3 text-sm text-state-confirm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">認定期限が近い薬剤師がいます</p>
            <ul className="mt-1 list-inside list-disc text-state-confirm">
              {alertItems.map((credential) => {
                const days = differenceInDays(parseISO(credential.expiry_date!), new Date());
                return (
                  <li key={credential.id}>
                    {credential.user_name} — {days < 0 ? '期限切れ' : `残${days}日`}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">薬剤師資格一覧</CardTitle>
          <Button
            className="h-11 min-h-[44px] sm:h-11 sm:min-h-[44px]"
            onClick={() => {
              setEditingCredential(null);
              reset(EMPTY_FORM);
              setFormOpen(true);
            }}
          >
            資格を登録
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {isError ? (
            // 取得失敗時は空の一覧(false-empty)にせず、再読み込み導線つきの ErrorState を出す。
            <ErrorState
              size="inline"
              description="薬剤師認定情報を取得できませんでした。時間をおいて再読み込みしてください。"
              action={{ label: '再読み込み', onClick: () => void refetch() }}
              className="m-4"
            />
          ) : (
            <>
              <div className="border-b px-4 py-3 text-xs text-muted-foreground">
                {credentialsListSummary}
              </div>
              <DataTable
                columns={columns}
                data={credentials}
                isLoading={isLoading}
                caption="薬剤師研修認定一覧"
              />
            </>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) {
            setEditingCredential(null);
            reset(EMPTY_FORM);
          }
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingCredential ? '資格情報を編集' : '資格情報を登録'}</DialogTitle>
            <DialogDescription>資格種別、番号、有効期限、在籍年数を管理します。</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit(() => saveMutation.mutate(), focusErrorSummary)} noValidate>
            <FormErrorSummary id={errorSummaryId} items={errorSummaryItems} />
            <div className="grid gap-4 py-2 md:grid-cols-2">
              <Field label="対象スタッフ" htmlFor="credential-user">
                {pharmacistsQuery.isError ? (
                  // スタッフ一覧の取得失敗時は空の選択肢(false-empty)にせず、原因と再読み込み導線を示す。
                  <div
                    id="credential-user-error"
                    role="alert"
                    className="flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
                  >
                    <span>スタッフ一覧を取得できませんでした。</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void pharmacistsQuery.refetch()}
                    >
                      再読み込み
                    </Button>
                  </div>
                ) : (
                  <Controller
                    control={control}
                    name="user_id"
                    render={({ field }) => (
                      <Select
                        value={field.value || 'unselected'}
                        onValueChange={(value) =>
                          field.onChange(value && value !== 'unselected' ? value : '')
                        }
                      >
                        <SelectTrigger id="credential-user">
                          <SelectValue placeholder="選択してください" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unselected">選択してください</SelectItem>
                          {pharmacistOptions.map((option) => (
                            <SelectItem key={option.id} value={option.id}>
                              {option.name}
                              {option.site_name ? ` / ${option.site_name}` : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                )}
              </Field>
              <Field label="認定種別" htmlFor="credential-certification-type">
                <Input
                  id="credential-certification-type"
                  {...register('certification_type')}
                  aria-invalid={Boolean(errors.certification_type)}
                  placeholder="かかりつけ薬剤師研修認定"
                />
              </Field>
              <Field label="認定番号" htmlFor="credential-certification-number">
                <Input
                  id="credential-certification-number"
                  {...register('certification_number')}
                  aria-invalid={Boolean(errors.certification_number)}
                />
              </Field>
              <Field label="交付日" htmlFor="credential-issued-date">
                <Input
                  id="credential-issued-date"
                  type="date"
                  max={form.expiry_date || undefined}
                  {...register('issued_date')}
                  aria-invalid={Boolean(errors.issued_date)}
                  aria-describedby="credential-issued-date-help"
                />
                <p id="credential-issued-date-help" className="text-xs text-muted-foreground">
                  有効期限以前の日付を指定します。空欄は未設定。
                </p>
              </Field>
              <Field label="有効期限" htmlFor="credential-expiry-date">
                <Input
                  id="credential-expiry-date"
                  type="date"
                  min={form.issued_date || undefined}
                  {...register('expiry_date')}
                  aria-invalid={Boolean(formErrors.expiry_date)}
                  aria-describedby={descriptionIds(
                    'credential-expiry-date-help',
                    formErrors.expiry_date && 'credential-expiry-date-error',
                  )}
                />
                <p id="credential-expiry-date-help" className="text-xs text-muted-foreground">
                  交付日以降の日付を指定します。空欄は未設定。
                </p>
                {formErrors.expiry_date ? (
                  <p
                    id="credential-expiry-date-error"
                    className="text-xs text-destructive"
                    role="alert"
                  >
                    {formErrors.expiry_date}
                  </p>
                ) : null}
              </Field>
              <Field label="在籍年数" htmlFor="credential-tenure-years">
                <Input
                  id="credential-tenure-years"
                  type="number"
                  min={CREDENTIAL_NUMERIC_LIMITS.tenure_years.min}
                  max={CREDENTIAL_NUMERIC_LIMITS.tenure_years.max}
                  step={CREDENTIAL_NUMERIC_LIMITS.tenure_years.step}
                  inputMode="decimal"
                  {...register('tenure_years')}
                  aria-invalid={Boolean(formErrors.tenure_years)}
                  aria-describedby={descriptionIds(
                    'credential-tenure-years-help',
                    formErrors.tenure_years && 'credential-tenure-years-error',
                  )}
                />
                <p id="credential-tenure-years-help" className="text-xs text-muted-foreground">
                  {CREDENTIAL_NUMERIC_LIMITS.tenure_years.help}
                </p>
                {formErrors.tenure_years ? (
                  <p
                    id="credential-tenure-years-error"
                    className="text-xs text-destructive"
                    role="alert"
                  >
                    {formErrors.tenure_years}
                  </p>
                ) : null}
              </Field>
              <Field label="週勤務時間" htmlFor="credential-weekly-work-hours">
                <Input
                  id="credential-weekly-work-hours"
                  type="number"
                  min={CREDENTIAL_NUMERIC_LIMITS.weekly_work_hours.min}
                  max={CREDENTIAL_NUMERIC_LIMITS.weekly_work_hours.max}
                  step={CREDENTIAL_NUMERIC_LIMITS.weekly_work_hours.step}
                  inputMode="decimal"
                  {...register('weekly_work_hours')}
                  aria-invalid={Boolean(formErrors.weekly_work_hours)}
                  aria-describedby={descriptionIds(
                    'credential-weekly-work-hours-help',
                    formErrors.weekly_work_hours && 'credential-weekly-work-hours-error',
                  )}
                />
                <p id="credential-weekly-work-hours-help" className="text-xs text-muted-foreground">
                  {CREDENTIAL_NUMERIC_LIMITS.weekly_work_hours.help}
                </p>
                {formErrors.weekly_work_hours ? (
                  <p
                    id="credential-weekly-work-hours-error"
                    className="text-xs text-destructive"
                    role="alert"
                  >
                    {formErrors.weekly_work_hours}
                  </p>
                ) : null}
              </Field>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
                キャンセル
              </Button>
              {saveBlocker ? (
                <p id={CREDENTIAL_SAVE_BLOCKER_ID} className="self-center text-xs text-destructive">
                  {saveBlocker}
                </p>
              ) : null}
              <Button
                type="submit"
                disabled={saveMutation.isPending || Boolean(saveBlocker)}
                aria-describedby={saveBlocker ? CREDENTIAL_SAVE_BLOCKER_ID : undefined}
              >
                {saveMutation.isPending ? '保存中...' : '保存'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>資格情報を失効しますか</DialogTitle>
            <DialogDescription>
              {deleteTarget?.user_name} の {deleteTarget?.certification_type} を削除します。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              キャンセル
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? '削除中...' : '失効する'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
