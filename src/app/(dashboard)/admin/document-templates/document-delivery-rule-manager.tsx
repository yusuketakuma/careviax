'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState } from '@/components/ui/error-state';
import { FormErrorSummary } from '@/components/ui/form-error-summary';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SkeletonRows } from '@/components/ui/loading';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import {
  DOCUMENT_DELIVERY_RULES_API_PATH,
  buildDocumentDeliveryRulesApiPath,
  buildDocumentDeliveryRuleApiPath,
} from '@/lib/document-templates/api-paths';
import { collectFormErrorSummaryItems } from '@/lib/forms/errors';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { messageFromError } from '@/lib/utils/error-message';

type DeliveryChannel = 'email' | 'fax' | 'mcs';

type DocumentDeliveryRuleRow = {
  id: string;
  document_type: string;
  target_role: string;
  channel: DeliveryChannel;
  fallback_channels: string[] | null;
  is_active: boolean;
};

type DocumentDeliveryRulesResponse = {
  data: DocumentDeliveryRuleRow[];
  total_count?: number;
  visible_count?: number;
  hidden_count?: number;
  truncated?: boolean;
  count_basis?: 'document_delivery_rules';
  filters_applied?: {
    document_type?: string | null;
  };
  limit?: number;
};

const DOCUMENT_TYPE_OPTIONS = [
  { value: 'care_report', label: '報告書' },
  { value: 'tracing_report', label: 'トレーシングレポート' },
  { value: 'management_plan', label: '計画書' },
  { value: 'contract_document', label: '契約書' },
  { value: 'important_matters', label: '重要事項説明書' },
  { value: 'privacy_consent', label: '個人情報同意書' },
  { value: 'consent_form', label: '同意書' },
] as const;

const TARGET_ROLE_OPTIONS = [
  { value: 'physician', label: '医師' },
  { value: 'care_manager', label: 'ケアマネ' },
  { value: 'facility_staff', label: '施設職員' },
  { value: 'nurse', label: '訪看/看護師' },
  { value: 'family', label: '家族' },
  { value: 'patient_family', label: '本人/家族' },
  { value: 'other', label: 'その他' },
] as const;

const CHANNEL_LABELS: Record<DeliveryChannel, string> = {
  email: 'メール',
  fax: 'FAX',
  mcs: 'MCS',
};

const documentDeliveryRuleFormSchema = z.object({
  id: z.string(),
  documentType: z.string(),
  targetRole: z.string(),
  channel: z.enum(['email', 'fax', 'mcs']),
  fallbackChannelsText: z.string(),
  isActive: z.boolean(),
});

type DocumentDeliveryRuleFormValues = z.infer<typeof documentDeliveryRuleFormSchema>;

const EMPTY_FORM: DocumentDeliveryRuleFormValues = {
  id: '',
  documentType: 'care_report',
  targetRole: 'physician',
  channel: 'fax' as DeliveryChannel,
  fallbackChannelsText: 'email',
  isActive: true,
};

function normalizeFallbackChannels(input: string, primaryChannel: DeliveryChannel) {
  return Array.from(
    new Set(
      input
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(
          (value): value is DeliveryChannel =>
            value === 'email' || value === 'fax' || value === 'mcs',
        )
        .filter((value) => value !== primaryChannel),
    ),
  );
}

function documentTypeLabel(value: string) {
  return DOCUMENT_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function targetRoleLabel(value: string) {
  return TARGET_ROLE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function deliveryRuleSummary(rule: DocumentDeliveryRuleRow) {
  return `${documentTypeLabel(rule.document_type)} / ${targetRoleLabel(rule.target_role)} / ${
    CHANNEL_LABELS[rule.channel] ?? rule.channel
  }`;
}

export function DocumentDeliveryRuleManager() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const errorSummaryId = 'document-delivery-rule-error-summary';
  const formMethods = useForm<DocumentDeliveryRuleFormValues>({
    resolver: zodResolver(documentDeliveryRuleFormSchema),
    defaultValues: EMPTY_FORM,
  });
  const {
    control,
    formState: { errors },
    getValues,
    handleSubmit,
    register,
    reset,
  } = formMethods;
  const watchedForm = useWatch({ control });
  const form: DocumentDeliveryRuleFormValues = {
    ...EMPTY_FORM,
    ...watchedForm,
  };
  const [deleteTarget, setDeleteTarget] = useState<DocumentDeliveryRuleRow | null>(null);
  const errorSummaryItems = collectFormErrorSummaryItems(errors, {
    documentType: '文書種別',
    targetRole: '送達先ロール',
    channel: '既定チャネル',
    fallbackChannelsText: 'フォールバック順',
    isActive: '有効化',
  });

  function focusErrorSummary() {
    if (typeof document === 'undefined') return;
    document.getElementById(errorSummaryId)?.focus();
  }

  const rulesQuery = useQuery({
    queryKey: ['document-delivery-rules', orgId],
    queryFn: async () => {
      const res = await fetch(buildDocumentDeliveryRulesApiPath(), {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<DocumentDeliveryRulesResponse>(res, '文書送達ルールの取得に失敗しました');
    },
    enabled: !!orgId,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const currentForm = getValues();
      const fallbackChannels = normalizeFallbackChannels(
        currentForm.fallbackChannelsText,
        currentForm.channel,
      );
      const res = await fetch(
        currentForm.id
          ? buildDocumentDeliveryRuleApiPath(currentForm.id)
          : DOCUMENT_DELIVERY_RULES_API_PATH,
        {
          method: currentForm.id ? 'PATCH' : 'POST',
          headers: buildOrgJsonHeaders(orgId),
          body: JSON.stringify({
            document_type: currentForm.documentType,
            target_role: currentForm.targetRole,
            channel: currentForm.channel,
            fallback_channels: fallbackChannels,
            is_active: currentForm.isActive,
          }),
        },
      );
      await readApiJson<unknown>(res, '文書送達ルールの保存に失敗しました');
      return { wasEditing: Boolean(currentForm.id) };
    },
    onSuccess: async ({ wasEditing }) => {
      toast.success(wasEditing ? '文書送達ルールを更新しました' : '文書送達ルールを登録しました');
      reset(EMPTY_FORM);
      await queryClient.invalidateQueries({ queryKey: ['document-delivery-rules', orgId] });
    },
    onError: (error) => {
      toast.error(messageFromError(error, '文書送達ルールの保存に失敗しました'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (ruleId: string) => {
      const res = await fetch(buildDocumentDeliveryRuleApiPath(ruleId), {
        method: 'DELETE',
        headers: buildOrgHeaders(orgId),
      });
      await readApiJson<unknown>(res, '文書送達ルールの削除に失敗しました');
    },
    onSuccess: async (_data, ruleId) => {
      toast.success('文書送達ルールを削除しました');
      if (getValues().id === ruleId) {
        reset(EMPTY_FORM);
      }
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['document-delivery-rules', orgId] });
    },
    onError: (error) => {
      toast.error(messageFromError(error, '文書送達ルールの削除に失敗しました'));
    },
  });

  const rulesResponse = rulesQuery.data;
  const rules = rulesResponse?.data ?? [];
  const visibleRuleCount = rulesResponse?.visible_count ?? rules.length;
  const totalRuleCount = rulesResponse?.total_count ?? visibleRuleCount;
  const hiddenRuleCount = Math.max(
    rulesResponse?.hidden_count ?? totalRuleCount - visibleRuleCount,
    0,
  );
  const isRuleListTruncated = Boolean(rulesResponse?.truncated ?? hiddenRuleCount > 0);
  const ruleCountLabel = isRuleListTruncated
    ? `先頭${visibleRuleCount}件を表示 / 他${hiddenRuleCount}件`
    : `登録${totalRuleCount}件`;

  return (
    <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle asChild className="text-base">
            <h3>{form.id ? '送達ルールを編集' : '送達ルールを登録'}</h3>
          </CardTitle>
          <CardDescription>
            文書種別と相手ロールごとに、既定チャネルとフォールバック順を定義します。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleSubmit(() => saveMutation.mutate(), focusErrorSummary)}
            noValidate
            className="space-y-4"
          >
            <FormErrorSummary id={errorSummaryId} items={errorSummaryItems} />
            <div className="space-y-2">
              <Label htmlFor="delivery-document-type">文書種別</Label>
              <Controller
                control={control}
                name="documentType"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(value) => value && field.onChange(value)}
                  >
                    <SelectTrigger id="delivery-document-type">
                      <SelectValue>{documentTypeLabel(field.value)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {DOCUMENT_TYPE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="delivery-target-role">送達先ロール</Label>
              <Controller
                control={control}
                name="targetRole"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(value) => value && field.onChange(value)}
                  >
                    <SelectTrigger id="delivery-target-role">
                      <SelectValue>{targetRoleLabel(field.value)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {TARGET_ROLE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="delivery-channel">既定チャネル</Label>
              <Controller
                control={control}
                name="channel"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(value) => value && field.onChange(value as DeliveryChannel)}
                  >
                    <SelectTrigger id="delivery-channel">
                      <SelectValue>{CHANNEL_LABELS[field.value]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(CHANNEL_LABELS).map(([value, label]) => (
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
              <Label htmlFor="delivery-fallback">フォールバック順</Label>
              <Input
                id="delivery-fallback"
                {...register('fallbackChannelsText')}
                aria-invalid={!!errors.fallbackChannelsText}
                placeholder="email,mcs"
              />
              <p className="text-xs text-muted-foreground">
                `email,fax,mcs` をカンマ区切りで入力します。既定チャネルは自動除外されます。
              </p>
            </div>

            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <div>
                <p id="delivery-rule-active-label" className="text-sm font-medium">
                  有効化
                </p>
                <p id="delivery-rule-active-description" className="text-xs text-muted-foreground">
                  無効にするとこの組み合わせでは自動提案しません
                </p>
              </div>
              <Controller
                control={control}
                name="isActive"
                render={({ field }) => (
                  <Switch
                    checked={field.value}
                    aria-labelledby="delivery-rule-active-label"
                    aria-describedby="delivery-rule-active-description"
                    onCheckedChange={field.onChange}
                  />
                )}
              />
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? '保存中...' : form.id ? '更新する' : '登録する'}
              </Button>
              {form.id ? (
                <Button type="button" variant="outline" onClick={() => reset(EMPTY_FORM)}>
                  キャンセル
                </Button>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle asChild className="text-base">
            <h3>送達ルール一覧</h3>
          </CardTitle>
          <CardDescription>
            報告書詳細画面では、この設定を優先して送達チャネル候補を並べます。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!rulesQuery.isPending && !rulesQuery.isError ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">{ruleCountLabel}</p>
              {isRuleListTruncated ? (
                <p role="status" className="text-sm text-state-confirm">
                  文書送達ルールは上限内の先頭行だけを表示しています。未表示のルールが報告書送達候補に影響する可能性があります。
                </p>
              ) : null}
            </div>
          ) : null}
          {rulesQuery.isError ? (
            <ErrorState
              variant="server"
              size="inline"
              headingLevel={4}
              title="送達ルールを取得できませんでした"
              description={
                rulesQuery.error instanceof Error
                  ? rulesQuery.error.message
                  : '文書送達ルールの取得に失敗しました'
              }
              onRetry={() => void rulesQuery.refetch()}
              live="polite"
            />
          ) : rulesQuery.isPending ? (
            // isPending (not isLoading) so an unresolved orgId — which disables the query
            // (enabled: !!orgId) and leaves it pending-but-not-fetching — also shows loading
            // rather than the empty-state.
            <div role="status" aria-label="送達ルールを読み込み中" aria-live="polite">
              <SkeletonRows rows={2} cols={3} status={false} />
            </div>
          ) : rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">文書送達ルールはまだありません。</p>
          ) : (
            rules.map((rule) => (
              <div key={rule.id} className="rounded-lg border border-border/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-foreground">
                      {documentTypeLabel(rule.document_type)}
                    </p>
                    <Badge variant="outline">{targetRoleLabel(rule.target_role)}</Badge>
                    <Badge>{CHANNEL_LABELS[rule.channel] ?? rule.channel}</Badge>
                    <Badge variant={rule.is_active ? 'default' : 'outline'}>
                      {rule.is_active ? '有効' : '停止'}
                    </Badge>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`${deliveryRuleSummary(rule)} の送達ルールを編集`}
                      onClick={() =>
                        reset({
                          id: rule.id,
                          documentType: rule.document_type,
                          targetRole: rule.target_role,
                          channel: rule.channel,
                          fallbackChannelsText: (rule.fallback_channels ?? []).join(','),
                          isActive: rule.is_active,
                        })
                      }
                    >
                      編集
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDeleteTarget(rule)}
                      disabled={deleteMutation.isPending}
                      aria-label={`${deliveryRuleSummary(rule)} の送達ルールを削除`}
                    >
                      削除
                    </Button>
                  </div>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  フォールバック:{' '}
                  {(rule.fallback_channels ?? []).length > 0
                    ? (rule.fallback_channels ?? []).join(' → ')
                    : 'なし'}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) {
            setDeleteTarget(null);
          }
        }}
        title="送達ルールを削除しますか"
        description={
          deleteTarget
            ? `${deliveryRuleSummary(
                deleteTarget,
              )} の送達ルールを削除します。この操作は取り消せません。報告書詳細画面の送達候補にも反映されます。`
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
    </div>
  );
}
