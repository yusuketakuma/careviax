'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminAlertRulesShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState } from '@/components/ui/error-state';
import { FormErrorSummary } from '@/components/ui/form-error-summary';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import {
  DRUG_ALERT_RULES_API_PATH,
  buildDrugAlertRuleApiPath,
} from '@/lib/drug-alert-rules/api-paths';
import { messageFromError } from '@/lib/utils/error-message';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { SignalTuningPanel } from './signal-tuning-panel';
import { PageSection } from '@/components/layout/page-section';
import { ActionRail } from '@/components/ui/action-rail';
import { parseJsonObjectText } from '@/lib/admin/json-editor';
import { collectFormErrorSummaryItems } from '@/lib/forms/errors';

type DrugAlertRule = {
  id: string;
  org_id: string | null;
  alert_type: string;
  condition: Record<string, unknown>;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  is_active: boolean;
  updated_at: string;
};

type DrugAlertRulesResponse = {
  data: DrugAlertRule[];
  total_count?: number;
  visible_count?: number;
  hidden_count?: number;
  truncated?: boolean;
  count_basis?: 'drug_alert_rules';
  filters_applied?: Record<string, unknown>;
  limit?: number;
};

type AlertRuleForm = {
  id: string;
  alert_type: string;
  severity: DrugAlertRule['severity'];
  is_active: boolean;
  message: string;
  conditionText: string;
};

const ALERT_TYPE_LABELS: Record<string, string> = {
  interaction: '相互作用',
  duplicate: '重複投薬',
  allergy_cross: 'アレルギー交差',
  renal_dose: '腎機能用量',
  pim_elderly: '高齢者 PIM',
  high_risk: 'ハイリスク薬',
  narcotic: '麻薬・向精神薬',
  max_days: '投与日数上限',
};

// CLAUDE.md SSOT: 警告は重大/注意/情報の3段階。生 enum(critical等)を表に出さない
const SEVERITY_LABELS: Record<'critical' | 'warning' | 'info', string> = {
  critical: '重大',
  warning: '注意',
  info: '情報',
};

function severityLabel(severity: string): string {
  return SEVERITY_LABELS[severity as keyof typeof SEVERITY_LABELS] ?? severity;
}

const EMPTY_ALERT_RULE_FORM: AlertRuleForm = {
  id: '',
  alert_type: 'interaction',
  severity: 'warning',
  is_active: true,
  message: '',
  conditionText: '{}',
};

const CONDITION_ERROR_MESSAGE = '条件(JSON) の形式が不正です';
const CONDITION_ERROR_ID = 'alert-rule-condition-error';
const ALERT_RULE_SAVE_BLOCKER_ID = 'alert-rule-save-blocker';

function normalizeAlertRuleForm(form?: Partial<AlertRuleForm> | null): AlertRuleForm {
  return {
    id: form?.id ?? EMPTY_ALERT_RULE_FORM.id,
    alert_type: form?.alert_type ?? EMPTY_ALERT_RULE_FORM.alert_type,
    severity: form?.severity ?? EMPTY_ALERT_RULE_FORM.severity,
    is_active: form?.is_active ?? EMPTY_ALERT_RULE_FORM.is_active,
    message: form?.message ?? EMPTY_ALERT_RULE_FORM.message,
    conditionText: form?.conditionText ?? EMPTY_ALERT_RULE_FORM.conditionText,
  };
}

function toAlertRuleForm(rule: DrugAlertRule): AlertRuleForm {
  return normalizeAlertRuleForm({
    id: rule.id,
    alert_type: rule.alert_type,
    severity: rule.severity,
    is_active: rule.is_active,
    message: rule.message,
    conditionText: JSON.stringify(rule.condition ?? {}, null, 2),
  });
}

function getAlertRuleConditionError(conditionText: string) {
  try {
    parseJsonObjectText(conditionText, CONDITION_ERROR_MESSAGE);
    return null;
  } catch (error) {
    return messageFromError(error, CONDITION_ERROR_MESSAGE);
  }
}

function getAlertRuleSaveBlocker(_form: AlertRuleForm, conditionError: string | null) {
  return conditionError;
}

function getAlertRuleBlockerPath(
  _form: AlertRuleForm,
  conditionError: string | null,
): keyof AlertRuleForm {
  if (conditionError) return 'conditionText';
  return 'conditionText';
}

const alertRuleFormSchema = z
  .object({
    id: z.string(),
    alert_type: z.string(),
    severity: z.custom<DrugAlertRule['severity']>(),
    is_active: z.boolean(),
    message: z.string(),
    conditionText: z.string(),
  })
  .superRefine((value, ctx) => {
    const form = normalizeAlertRuleForm(value);
    const conditionError = getAlertRuleConditionError(form.conditionText);
    const blocker = getAlertRuleSaveBlocker(form, conditionError);
    if (!blocker) return;

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [getAlertRuleBlockerPath(form, conditionError)],
      message: blocker,
    });
  });

export default function AlertRulesPage() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const errorSummaryId = 'alert-rule-form-error-summary';
  const {
    control,
    formState: { errors },
    getValues,
    handleSubmit,
    register,
    reset,
  } = useForm<AlertRuleForm>({
    resolver: zodResolver(alertRuleFormSchema),
    defaultValues: EMPTY_ALERT_RULE_FORM,
  });
  const form = normalizeAlertRuleForm(useWatch({ control, defaultValue: EMPTY_ALERT_RULE_FORM }));
  const conditionError = getAlertRuleConditionError(form.conditionText);
  const saveBlocker = getAlertRuleSaveBlocker(form, conditionError);
  const errorSummaryItems = collectFormErrorSummaryItems(errors, {
    alert_type: 'アラート種別',
    severity: '重要度',
    is_active: '有効化',
    message: '表示メッセージ',
    conditionText: '条件(JSON)',
  });
  const [testCycleId, setTestCycleId] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<DrugAlertRule | null>(null);

  function focusErrorSummary() {
    if (typeof document === 'undefined') return;
    document.getElementById(errorSummaryId)?.focus();
  }

  const rulesQuery = useQuery({
    queryKey: ['drug-alert-rules', orgId],
    queryFn: async () => {
      const res = await fetch(DRUG_ALERT_RULES_API_PATH, {
        headers: buildOrgHeaders(orgId),
      });
      if (!res.ok) throw new Error('処方安全アラートルールの取得に失敗しました');
      return res.json() as Promise<DrugAlertRulesResponse>;
    },
    enabled: !!orgId,
    staleTime: 300_000,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const values = normalizeAlertRuleForm(getValues());
      const blocker = getAlertRuleSaveBlocker(
        values,
        getAlertRuleConditionError(values.conditionText),
      );
      if (blocker) throw new Error(blocker);
      const parsedCondition = parseJsonObjectText(values.conditionText, CONDITION_ERROR_MESSAGE);

      // buildDrugAlertRuleApiPath validates during URL construction, so a dot
      // segment id fails closed BEFORE the mutating PATCH side effect.
      const res = await fetch(
        values.id ? buildDrugAlertRuleApiPath(values.id) : DRUG_ALERT_RULES_API_PATH,
        {
          method: values.id ? 'PATCH' : 'POST',
          headers: buildOrgJsonHeaders(orgId),
          body: JSON.stringify({
            alert_type: values.alert_type,
            severity: values.severity,
            is_active: values.is_active,
            message: values.message,
            condition: parsedCondition,
          }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? '処方安全アラートルールの保存に失敗しました');
      }
      await res.json();
      return { wasEditing: Boolean(values.id) };
    },
    onSuccess: async ({ wasEditing }) => {
      toast.success(
        wasEditing
          ? '処方安全アラートルールを更新しました'
          : '処方安全アラートルールを登録しました',
      );
      reset(EMPTY_ALERT_RULE_FORM);
      await queryClient.invalidateQueries({ queryKey: ['drug-alert-rules', orgId] });
    },
    onError: (error) => {
      toast.error(messageFromError(error, '保存に失敗しました'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // buildDrugAlertRuleApiPath validates before fetch, so a dot-segment id fails closed
      // BEFORE the destructive DELETE side effect.
      const res = await fetch(buildDrugAlertRuleApiPath(id), {
        method: 'DELETE',
        headers: buildOrgHeaders(orgId),
      });
      if (!res.ok) throw new Error('削除に失敗しました');
    },
    onSuccess: async (_data, deletedId) => {
      toast.success('処方安全アラートルールを削除しました');
      if (form.id === deletedId) {
        reset(EMPTY_ALERT_RULE_FORM);
      }
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['drug-alert-rules', orgId] });
    },
    onError: (error) => {
      toast.error(messageFromError(error, '削除に失敗しました'));
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/cds/check', {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({ cycleId: testCycleId }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (payload as { message?: string }).message ?? '処方安全チェックの実行に失敗しました',
        );
      }
      return payload as { alerts: Array<{ message: string; severity: string }> };
    },
    onSuccess: (payload) => {
      toast.success(`テスト実行完了: ${payload.alerts.length}件のアラート`);
    },
    onError: (error) => {
      toast.error(messageFromError(error, 'テスト実行に失敗しました'));
    },
  });

  const rules = rulesQuery.data?.data ?? [];
  const totalRuleCount = rulesQuery.data?.total_count ?? rules.length;
  const visibleRuleCount = rulesQuery.data?.visible_count ?? rules.length;
  const hiddenRuleCount =
    rulesQuery.data?.hidden_count ?? Math.max(totalRuleCount - rules.length, 0);
  const isRuleListTruncated = Boolean(rulesQuery.data?.truncated || hiddenRuleCount > 0);

  return (
    <PageScaffold>
      <AdminPageHeader
        title="処方安全アラートルール"
        description="相互作用、重複、高齢者 PIM などのルールを ON/OFF と条件 JSON で管理します。"
        shortcuts={getAdminAlertRulesShortcutLinks()}
        supportingContent={null}
      />

      <div
        className="grid gap-6 [&_button]:!h-11 [&_button]:!min-h-[44px] [&_input]:!h-11 [&_input]:!min-h-[44px] xl:grid-cols-[minmax(0,1fr)_420px]"
        data-testid="alert-rules-workspace"
      >
        <div className="space-y-6">
          <PageSection title="登録済みルール" contentClassName="space-y-3">
            {rulesQuery.data ? (
              <p className="text-xs text-muted-foreground">
                {isRuleListTruncated
                  ? `先頭${visibleRuleCount.toLocaleString()}件を表示 / 他${hiddenRuleCount.toLocaleString()}件`
                  : `登録${totalRuleCount.toLocaleString()}件`}
              </p>
            ) : null}
            {isRuleListTruncated ? (
              <p className="rounded-md border border-state-confirm/40 bg-state-confirm/5 px-3 py-2 text-xs text-state-confirm">
                {`処方安全アラートルールは先頭${visibleRuleCount.toLocaleString()}件のみ表示中です。他${hiddenRuleCount.toLocaleString()}件はアラート種別で絞り込むか limit を上げて確認してください。`}
              </p>
            ) : null}
            {rulesQuery.isError ? (
              // 取得失敗時は空状態（false-empty）にせず、再読み込み導線つきの ErrorState を出す。
              <ErrorState
                variant="server"
                size="inline"
                action={{ label: '再読み込み', onClick: () => void rulesQuery.refetch() }}
              />
            ) : rules.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                まだ処方安全アラートルールはありません。
              </p>
            ) : (
              rules.map((rule) => {
                const canMutateRule = rule.org_id === orgId;
                return (
                  <div key={rule.id} className="rounded-lg border border-border/60 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-foreground">
                          {ALERT_TYPE_LABELS[rule.alert_type] ?? rule.alert_type}
                        </p>
                        <Badge variant={rule.is_active ? 'default' : 'outline'}>
                          {rule.is_active ? '有効' : '停止'}
                        </Badge>
                        <Badge variant="outline">{severityLabel(rule.severity)}</Badge>
                        <Badge variant="secondary">{canMutateRule ? '組織' : '共通'}</Badge>
                      </div>
                      {canMutateRule ? (
                        <ActionRail>
                          <Button
                            variant="outline"
                            aria-label={`${
                              ALERT_TYPE_LABELS[rule.alert_type] ?? rule.alert_type
                            } の処方安全アラートルールを編集`}
                            onClick={() => reset(toAlertRuleForm(rule))}
                          >
                            編集
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => setDeleteTarget(rule)}
                            disabled={deleteMutation.isPending}
                            aria-label={`${
                              ALERT_TYPE_LABELS[rule.alert_type] ?? rule.alert_type
                            } の処方安全アラートルールを削除`}
                          >
                            削除
                          </Button>
                        </ActionRail>
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{rule.message}</p>
                    <pre className="mt-3 overflow-x-auto rounded-md bg-muted/40 p-3 text-xs leading-5 text-foreground">
                      {JSON.stringify(rule.condition ?? {}, null, 2)}
                    </pre>
                  </div>
                );
              })
            )}
          </PageSection>

          <PageSection
            title="テスト実行"
            description="既存の処方サイクル ID を指定すると処方安全チェックを即時実行します。"
            contentClassName="flex flex-wrap items-end gap-3"
          >
            <div className="space-y-2">
              <Label htmlFor="test-cycle-id">サイクル ID</Label>
              <Input
                id="test-cycle-id"
                value={testCycleId}
                onChange={(event) => setTestCycleId(event.target.value)}
                placeholder="cycle_xxx"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => testMutation.mutate()}
              disabled={!testCycleId || testMutation.isPending}
            >
              {testMutation.isPending ? '実行中...' : 'テスト実行'}
            </Button>
          </PageSection>
        </div>

        <PageSection
          title={form.id ? 'ルールを編集' : 'ルールを登録'}
          description="空条件 `{}` でも種別単位の ON/OFF ルールとして利用できます。"
        >
          <form
            className="space-y-4"
            onSubmit={handleSubmit(() => saveMutation.mutate(), focusErrorSummary)}
            noValidate
          >
            <FormErrorSummary id={errorSummaryId} items={errorSummaryItems} />
            <div className="space-y-2">
              <Label htmlFor="alert_type">アラート種別</Label>
              <Controller
                control={control}
                name="alert_type"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(value) => field.onChange(value ?? 'interaction')}
                  >
                    <SelectTrigger
                      id="alert_type"
                      className="min-h-[44px] w-full sm:min-h-[44px]"
                      aria-invalid={Boolean(errors.alert_type)}
                    >
                      {/* Radix は SSR で既定値ラベルを解決できないため表示文言を明示する */}
                      <SelectValue>
                        {ALERT_TYPE_LABELS[form.alert_type] ?? form.alert_type}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(ALERT_TYPE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="severity">重要度</Label>
              <Controller
                control={control}
                name="severity"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(value) =>
                      field.onChange((value ?? 'warning') as 'critical' | 'warning' | 'info')
                    }
                  >
                    <SelectTrigger
                      id="severity"
                      className="min-h-[44px] w-full sm:min-h-[44px]"
                      aria-invalid={Boolean(errors.severity)}
                    >
                      <SelectValue>{severityLabel(form.severity)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="critical">重大</SelectItem>
                      <SelectItem value="warning">注意</SelectItem>
                      <SelectItem value="info">情報</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <div>
                <Label htmlFor="alert-rule-active" className="text-sm font-medium">
                  有効化
                </Label>
                <p className="text-xs text-muted-foreground">
                  OFF にするとこのルールは実行対象から外れます
                </p>
              </div>
              <Controller
                control={control}
                name="is_active"
                render={({ field }) => (
                  <Switch
                    id="alert-rule-active"
                    className="!h-11 !w-14 px-1 data-[state=checked]:[&>span]:!translate-x-6 [&>span]:!size-6"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    aria-invalid={Boolean(errors.is_active)}
                  />
                )}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="message">表示メッセージ</Label>
              <Input
                id="message"
                aria-invalid={Boolean(errors.message)}
                placeholder="例: 併用禁忌候補を再確認してください"
                {...register('message')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="condition">条件(JSON)</Label>
              <Textarea
                id="condition"
                rows={8}
                className="font-mono text-xs"
                aria-invalid={conditionError ? true : undefined}
                aria-describedby={conditionError ? CONDITION_ERROR_ID : undefined}
                {...register('conditionText')}
              />
              {conditionError ? (
                <p id={CONDITION_ERROR_ID} className="text-xs text-destructive">
                  {conditionError}
                </p>
              ) : null}
            </div>

            <ActionRail align="start">
              <Button
                type="submit"
                disabled={saveMutation.isPending || Boolean(saveBlocker)}
                aria-describedby={saveBlocker ? ALERT_RULE_SAVE_BLOCKER_ID : undefined}
              >
                {saveMutation.isPending ? '保存中...' : form.id ? '更新する' : '登録する'}
              </Button>
              {form.id ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => reset(EMPTY_ALERT_RULE_FORM)}
                >
                  キャンセル
                </Button>
              ) : null}
            </ActionRail>
            {saveBlocker ? (
              <p id={ALERT_RULE_SAVE_BLOCKER_ID} className="text-xs text-destructive">
                {saveBlocker}
              </p>
            ) : null}
          </form>
        </PageSection>
      </div>

      {/* p1_14: 気になる処方の表示設定(強く表示/標準+カードプレビュー) */}
      <SignalTuningPanel />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) {
            setDeleteTarget(null);
          }
        }}
        title="処方安全アラートルールを削除しますか"
        description={
          deleteTarget
            ? `${
                ALERT_TYPE_LABELS[deleteTarget.alert_type] ?? deleteTarget.alert_type
              }（${severityLabel(deleteTarget.severity)}）の組織ルールを削除します。この操作は取り消せません。処方安全チェックの表示に反映されます。`
            : ''
        }
        confirmLabel={deleteMutation.isPending ? '削除中...' : '削除する'}
        confirmDisabled={deleteMutation.isPending}
        variant="destructive"
        closeOnConfirm={false}
        onConfirm={() => {
          if (deleteTarget) {
            deleteMutation.mutate(deleteTarget.id);
          }
        }}
      />
    </PageScaffold>
  );
}
