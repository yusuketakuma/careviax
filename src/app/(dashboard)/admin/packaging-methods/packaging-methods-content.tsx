'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/error-state';
import { FormErrorSummary } from '@/components/ui/form-error-summary';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SkeletonRows } from '@/components/ui/loading';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { collectFormErrorSummaryItems } from '@/lib/forms/errors';
import { useOrgId } from '@/lib/hooks/use-org-id';
import {
  PACKAGING_METHODS_API_PATH,
  buildPackagingMethodApiPath,
} from '@/lib/packaging-methods/api-paths';
import { messageFromError } from '@/lib/utils/error-message';

type PackagingMethodRow = {
  id: string;
  name: string;
  description: string | null;
  icon_key: string | null;
  sort_order: number;
  is_active: boolean;
};

type PackagingMethodsResponse = {
  data: PackagingMethodRow[];
  total_count?: number;
  visible_count?: number;
  hidden_count?: number;
  truncated?: boolean;
  count_basis?: 'packaging_methods';
  filters_applied?: Record<string, unknown>;
  limit?: number;
};

const packagingMethodFormSchema = z.object({
  id: z.string(),
  name: z.string().refine((value) => value.trim().length > 0, {
    message: '名称を入力してください',
  }),
  description: z.string(),
  icon_key: z.string(),
  sort_order: z.string(),
  is_active: z.boolean(),
});

type PackagingMethodFormValues = z.infer<typeof packagingMethodFormSchema>;

const emptyForm: PackagingMethodFormValues = {
  id: '',
  name: '',
  description: '',
  icon_key: '',
  sort_order: '0',
  is_active: true,
};

export function PackagingMethodsContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const errorSummaryId = 'packaging-method-error-summary';
  const formMethods = useForm<PackagingMethodFormValues>({
    resolver: zodResolver(packagingMethodFormSchema),
    defaultValues: emptyForm,
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
  const form: PackagingMethodFormValues = {
    ...emptyForm,
    ...watchedForm,
  };
  const errorSummaryItems = collectFormErrorSummaryItems(errors, {
    name: '名称',
    description: '説明',
    icon_key: 'アイコンキー',
    sort_order: '表示順',
    is_active: '有効',
  });

  function focusErrorSummary() {
    if (typeof document === 'undefined') return;
    document.getElementById(errorSummaryId)?.focus();
  }

  const methodsQuery = useQuery({
    queryKey: ['packaging-methods', orgId],
    queryFn: async () => {
      const res = await fetch(PACKAGING_METHODS_API_PATH, {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<PackagingMethodsResponse>(res, '配薬方法マスターの取得に失敗しました');
    },
    enabled: !!orgId,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const currentForm = getValues();
      const body = {
        name: currentForm.name,
        description: currentForm.description || undefined,
        icon_key: currentForm.icon_key || undefined,
        sort_order: Number(currentForm.sort_order || 0),
        is_active: currentForm.is_active,
      };
      const path = currentForm.id
        ? buildPackagingMethodApiPath(currentForm.id)
        : PACKAGING_METHODS_API_PATH;
      const res = await fetch(path, {
        method: currentForm.id ? 'PATCH' : 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? '配薬方法マスターの保存に失敗しました');
      }
      return { wasEditing: Boolean(currentForm.id) };
    },
    onSuccess: async ({ wasEditing }) => {
      toast.success(wasEditing ? '配薬方法を更新しました' : '配薬方法を登録しました');
      reset(emptyForm);
      await queryClient.invalidateQueries({ queryKey: ['packaging-methods', orgId] });
    },
    onError: (error) => {
      toast.error(messageFromError(error, '配薬方法マスターの保存に失敗しました'));
    },
  });

  const methods = methodsQuery.data?.data ?? [];
  const totalMethodCount = methodsQuery.data?.total_count ?? methods.length;
  const visibleMethodCount = methodsQuery.data?.visible_count ?? methods.length;
  const hiddenMethodCount =
    methodsQuery.data?.hidden_count ?? Math.max(totalMethodCount - methods.length, 0);
  const isMethodListTruncated = Boolean(methodsQuery.data?.truncated || hiddenMethodCount > 0);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(22rem,0.42fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {form.id ? '配薬方法を編集' : '配薬方法を追加'}
          </CardTitle>
          <CardDescription>
            一包化、服薬カレンダー、施設カートなど、セット工程で選ぶ方法を登録します。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleSubmit(() => saveMutation.mutate(), focusErrorSummary)}
            noValidate
            className="space-y-4"
          >
            <FormErrorSummary id={errorSummaryId} items={errorSummaryItems} />
            <div className="space-y-1.5">
              <Label htmlFor="packaging-method-name">名称</Label>
              <Input
                id="packaging-method-name"
                {...register('name')}
                aria-invalid={!!errors.name}
                placeholder="例: 一包化 / 施設カレンダー"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="packaging-method-description">説明</Label>
              <Textarea
                id="packaging-method-description"
                rows={3}
                {...register('description')}
                aria-invalid={!!errors.description}
                placeholder="セット・監査・訪問時に確認するポイント"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="packaging-method-icon">アイコンキー</Label>
                <Input
                  id="packaging-method-icon"
                  {...register('icon_key')}
                  aria-invalid={!!errors.icon_key}
                  placeholder="package"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="packaging-method-order">表示順</Label>
                <Input
                  id="packaging-method-order"
                  type="number"
                  min={0}
                  {...register('sort_order')}
                  aria-invalid={!!errors.sort_order}
                />
              </div>
            </div>
            <label className="flex items-center justify-between gap-3 rounded-xl border border-border/70 px-3 py-2 text-sm">
              <span>有効</span>
              <Controller
                control={control}
                name="is_active"
                render={({ field }) => (
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                )}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={saveMutation.isPending || !form.name.trim()}>
                {saveMutation.isPending ? '保存中...' : form.id ? '更新' : '登録'}
              </Button>
              {form.id ? (
                <Button type="button" variant="outline" onClick={() => reset(emptyForm)}>
                  新規入力に戻る
                </Button>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">登録済み配薬方法</CardTitle>
          <CardDescription>
            セット管理と患者の既定配薬方法で選択できるマスターです。
          </CardDescription>
          {methodsQuery.data ? (
            <p className="text-xs text-muted-foreground">
              {isMethodListTruncated
                ? `先頭${visibleMethodCount.toLocaleString()}件を表示 / 他${hiddenMethodCount.toLocaleString()}件`
                : `登録${totalMethodCount.toLocaleString()}件`}
            </p>
          ) : null}
        </CardHeader>
        <CardContent>
          {methodsQuery.isError ? (
            <ErrorState
              variant="server"
              size="inline"
              title="配薬方法マスターを取得できませんでした"
              description={
                methodsQuery.error instanceof Error
                  ? methodsQuery.error.message
                  : '配薬方法マスターの取得に失敗しました'
              }
              onRetry={() => void methodsQuery.refetch()}
              live="polite"
            />
          ) : methodsQuery.isPending ? (
            // isPending (not isLoading) so an unresolved orgId — which disables the query
            // (enabled: !!orgId) and leaves it pending-but-not-fetching — also shows loading
            // rather than the "未登録" empty-state.
            <div role="status" aria-label="配薬方法を読み込み中" aria-live="polite">
              <SkeletonRows rows={2} cols={2} status={false} />
            </div>
          ) : methods.length === 0 ? (
            <p className="rounded-xl border-l-4 border-border/70 border-l-state-confirm bg-card px-3 py-2 text-sm text-state-confirm">
              配薬方法が未登録です。セット作成前に最低1件登録してください。
            </p>
          ) : (
            <div className="space-y-3">
              {isMethodListTruncated ? (
                <p className="rounded-md border border-state-confirm/40 bg-state-confirm/5 px-3 py-2 text-xs text-state-confirm">
                  {`配薬方法マスターは先頭${visibleMethodCount.toLocaleString()}件のみ表示中です。他${hiddenMethodCount.toLocaleString()}件は表示順を見直すか、limit を上げて確認してください。`}
                </p>
              ) : null}
              <div className="grid gap-3 md:grid-cols-2">
                {methods.map((method) => (
                  <button
                    key={method.id}
                    type="button"
                    className="rounded-lg border border-border/70 bg-background p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/30"
                    onClick={() =>
                      reset({
                        id: method.id,
                        name: method.name,
                        description: method.description ?? '',
                        icon_key: method.icon_key ?? '',
                        sort_order: String(method.sort_order),
                        is_active: method.is_active,
                      })
                    }
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-foreground">{method.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {method.description ?? '説明未登録'}
                        </p>
                      </div>
                      <Badge variant={method.is_active ? 'default' : 'secondary'}>
                        {method.is_active ? '有効' : '無効'}
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">表示順 {method.sort_order}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
