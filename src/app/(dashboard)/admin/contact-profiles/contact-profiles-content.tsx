'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { ErrorState } from '@/components/ui/error-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SkeletonRows } from '@/components/ui/loading';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  CONTACT_METHOD_OPTIONS,
  contactMethodLabel,
  type ContactProfileKind,
} from '@/lib/contact-profile-options';
import { buildContactProfilesApiPath } from '@/lib/contact-profile-api-paths';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { cn } from '@/lib/utils';
import { messageFromError } from '@/lib/utils/error-message';

type ContactProfile = {
  id: string;
  kind: ContactProfileKind;
  name: string;
  subtitle: string | null;
  phone: string | null;
  email: string | null;
  fax: string | null;
  preferred_contact_method: string | null;
  preferred_contact_time: string | null;
  last_contacted_at: string | null;
  last_success_channel: string | null;
  recommended_channels: string[];
  contact_reliability?: {
    ready: boolean;
    warnings: string[];
    missing_channel_labels: string[];
  };
  active_patient_count: number;
  pending_response_count: number;
};

const KIND_LABELS: Record<ContactProfile['kind'], string> = {
  facility_contact: '施設担当者',
  external_professional: '他職種',
  prescriber_institution: '医療機関',
};

function labelOf(value: string | null) {
  return contactMethodLabel(value);
}

function formatLastContacted(value: string | null): string {
  return value ? new Date(value).toLocaleString('ja-JP') : '記録なし';
}

type ContactForm = {
  name: string;
  contactPerson: string;
  phone: string;
  fax: string;
  email: string;
  preferred_contact_method: string;
};

const NONE_METHOD = 'none';
const fieldClassName = 'space-y-1.5';

const contactFormSchema = z.object({
  name: z.string(),
  contactPerson: z.string(),
  phone: z.string(),
  fax: z.string(),
  email: z.string(),
  preferred_contact_method: z.string(),
});

function toForm(profile: ContactProfile): ContactForm {
  return {
    name: profile.name,
    contactPerson: profile.subtitle ?? '',
    phone: profile.phone ?? '',
    fax: profile.fax ?? '',
    email: profile.email ?? '',
    preferred_contact_method: profile.preferred_contact_method ?? NONE_METHOD,
  };
}

function normalizeContactForm(value: Partial<ContactForm> | undefined): ContactForm {
  return {
    name: value?.name ?? '',
    contactPerson: value?.contactPerson ?? '',
    phone: value?.phone ?? '',
    fax: value?.fax ?? '',
    email: value?.email ?? '',
    preferred_contact_method: value?.preferred_contact_method ?? NONE_METHOD,
  };
}

export function ContactProfilesContent() {
  const orgId = useOrgId();
  const [kind, setKind] = useState<'all' | ContactProfile['kind']>('all');
  const [query, setQuery] = useState('');
  // 検索は debounce(300ms)してからサーバ fetch に渡す(打鍵ごとの fetch を抑制)。入力は即時反映。
  const debouncedQuery = useDebouncedValue(query, 300);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const profilesQuery = useQuery({
    queryKey: ['contact-profiles', orgId, kind, debouncedQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (kind !== 'all') params.set('kind', kind);
      if (debouncedQuery.trim()) params.set('q', debouncedQuery.trim());
      const response = await fetch(buildContactProfilesApiPath(params), {
        headers: buildOrgHeaders(orgId),
      });
      if (!response.ok) throw new Error('連携先プロファイルの取得に失敗しました');
      return response.json() as Promise<{ data: ContactProfile[] }>;
    },
    enabled: !!orgId,
  });

  const rows = useMemo(() => profilesQuery.data?.data ?? [], [profilesQuery.data]);

  const selected = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? rows[0] ?? null,
    [rows, selectedId],
  );

  const pendingRowsCount = rows.filter((row) => row.pending_response_count > 0).length;
  // 未完了 KPI は全面塗りを引き算し左ボーダー+文字で示す。0件は中立(偽シグナル回避)。
  const hasPendingRows = pendingRowsCount > 0;
  const missingMethodRowsCount = rows.filter((row) => !row.preferred_contact_method).length;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">検索・フィルタ</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
          <div className="space-y-1.5">
            <Label htmlFor="contact-kind-filter">種別</Label>
            <Select value={kind} onValueChange={(value) => setKind(value as typeof kind)}>
              <SelectTrigger id="contact-kind-filter">
                {/* Radix は SSR で既定値のラベルを解決できず生 enum('all') を出すため、表示文言を明示する */}
                <SelectValue>{kind === 'all' ? 'すべて' : KIND_LABELS[kind]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">すべて</SelectItem>
                <SelectItem value="facility_contact">施設担当者</SelectItem>
                <SelectItem value="external_professional">他職種</SelectItem>
                <SelectItem value="prescriber_institution">医療機関</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contact-profile-search">検索</Label>
            <Input
              id="contact-profile-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="氏名・所属・電話・FAX・メール"
            />
          </div>
        </CardContent>
      </Card>

      <div
        className="grid gap-6 lg:grid-cols-[minmax(0,0.96fr)_minmax(360px,0.72fr)]"
        data-testid="contact-delivery-target-edit"
      >
        <Card>
          <CardHeader>
            <div className="space-y-3">
              <h2 className="font-heading text-base leading-snug font-medium">送付先一覧</h2>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
                  <p className="font-medium text-muted-foreground">表示中</p>
                  <p className="mt-1 text-base font-semibold text-foreground">{rows.length}件</p>
                </div>
                <div
                  className={cn(
                    'rounded-lg border border-border/70 border-l-2 bg-muted/20 px-3 py-2',
                    hasPendingRows && 'border-l-state-confirm',
                  )}
                >
                  <p
                    className={cn(
                      'font-medium',
                      hasPendingRows ? 'text-state-confirm' : 'text-muted-foreground',
                    )}
                  >
                    未完了
                  </p>
                  <p
                    className={cn(
                      'mt-1 text-base font-semibold',
                      hasPendingRows ? 'text-state-confirm' : 'text-foreground',
                    )}
                  >
                    {pendingRowsCount}件
                  </p>
                </div>
                <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
                  <p className="font-medium text-muted-foreground">方法未設定</p>
                  <p className="mt-1 text-base font-semibold text-foreground">
                    {missingMethodRowsCount}件
                  </p>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {profilesQuery.isError ? (
              // 取得失敗を「送付先がありません」(空)に倒さず、ErrorState + 再試行で示す
              <ErrorState
                variant="server"
                size="inline"
                title="送付先を取得できませんでした"
                description="時間をおいて再試行してください。"
                onRetry={() => profilesQuery.refetch()}
              />
            ) : profilesQuery.isLoading ? (
              <div role="status" aria-label="連携先を読み込み中" aria-live="polite">
                <SkeletonRows rows={3} cols={3} status={false} />
              </div>
            ) : rows.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border/70 px-4 py-8 text-sm text-muted-foreground">
                条件に一致する送付先がありません。
              </p>
            ) : (
              rows.map((row) => {
                const isSelected = row.id === selected?.id;
                const contactReliability = row.contact_reliability ?? {
                  ready: true,
                  warnings: [],
                  missing_channel_labels: [],
                };
                const recommended =
                  row.recommended_channels.length > 0
                    ? row.recommended_channels
                        .slice(0, 2)
                        .map((channel) => labelOf(channel))
                        .join(' → ')
                    : labelOf(row.preferred_contact_method);
                return (
                  <button
                    key={row.id}
                    type="button"
                    className={cn(
                      'w-full rounded-lg border px-4 py-3 text-left transition',
                      'hover:border-primary/45 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isSelected
                        ? 'border-primary/55 bg-primary/5 shadow-sm'
                        : 'border-border/70 bg-background',
                    )}
                    aria-pressed={isSelected}
                    onClick={() => {
                      setSelectedId(row.id);
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="truncate text-sm font-semibold">{row.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.subtitle ?? KIND_LABELS[row.kind]}
                        </div>
                      </div>
                      <Badge variant={row.pending_response_count > 0 ? 'secondary' : 'outline'}>
                        {KIND_LABELS[row.kind]}
                      </Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                      <span>既定: {labelOf(row.preferred_contact_method)}</span>
                      <span>推奨: {recommended}</span>
                      <span>
                        {contactReliability.ready
                          ? `関連: ${row.active_patient_count}名`
                          : `要整備: ${contactReliability.missing_channel_labels.join('・')}`}
                      </span>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {row.pending_response_count > 0
                        ? `未完了連携 ${row.pending_response_count}件`
                        : '未完了連携なし'}
                    </div>
                  </button>
                );
              })
            )}
          </CardContent>
        </Card>

        <ContactProfileEditor key={selected?.id ?? 'none'} orgId={orgId} selected={selected} />
      </div>
    </div>
  );
}

function ContactProfileEditor({
  orgId,
  selected,
}: {
  orgId: string;
  selected: ContactProfile | null;
}) {
  const queryClient = useQueryClient();
  const formMethods = useForm<ContactForm>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: selected ? toForm(selected) : normalizeContactForm(undefined),
  });
  const { control, getValues, handleSubmit, register } = formMethods;
  const form = normalizeContactForm(useWatch({ control }));

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error('編集対象が選択されていません');
      const currentForm = getValues();
      const response = await fetch(buildContactProfilesApiPath(), {
        method: 'PATCH',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          kind: selected.kind,
          id: selected.id,
          name: currentForm.name.trim(),
          ...(selected.kind === 'facility_contact'
            ? { role: currentForm.contactPerson.trim() || null }
            : {}),
          ...(selected.kind === 'external_professional'
            ? { department: currentForm.contactPerson.trim() || null }
            : {}),
          phone: currentForm.phone.trim() || null,
          fax: currentForm.fax.trim() || null,
          ...(selected.kind !== 'prescriber_institution'
            ? { email: currentForm.email.trim() || null }
            : {}),
          preferred_contact_method:
            currentForm.preferred_contact_method === NONE_METHOD
              ? null
              : currentForm.preferred_contact_method,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { message?: string }).message ?? '保存に失敗しました');
      }
      return payload;
    },
    onSuccess: async () => {
      toast.success('連絡先を保存しました');
      await queryClient.invalidateQueries({ queryKey: ['contact-profiles', orgId] });
    },
    onError: (error) => {
      toast.error(messageFromError(error, '保存に失敗しました'));
    },
  });

  const contactPersonLabel = selected?.kind === 'external_professional' ? '部署' : '担当者';
  const showContactPerson = selected?.kind !== 'prescriber_institution';
  const showEmail = selected?.kind !== 'prescriber_institution';
  const selectedRecommendedChannels = selected?.recommended_channels.length
    ? selected.recommended_channels.map((channel) => labelOf(channel)).join(' → ')
    : selected
      ? labelOf(selected.preferred_contact_method)
      : '未設定';
  const hasUnsavedChanges = selected
    ? JSON.stringify(form) !== JSON.stringify(toForm(selected))
    : false;
  const contactRouteLabel =
    form.preferred_contact_method === NONE_METHOD
      ? '送付方法未設定'
      : `${labelOf(form.preferred_contact_method)}で送付`;
  const contactFieldReady =
    form.preferred_contact_method === 'fax'
      ? !!form.fax.trim()
      : form.preferred_contact_method === 'phone'
        ? !!form.phone.trim()
        : form.preferred_contact_method === 'email'
          ? !!form.email.trim()
          : form.preferred_contact_method !== NONE_METHOD;
  const saveReviewLabel = !selected
    ? '編集対象なし'
    : form.preferred_contact_method === NONE_METHOD
      ? '送付方法を選択してください'
      : contactFieldReady
        ? `${contactRouteLabel}できます`
        : `${labelOf(form.preferred_contact_method)}の連絡先を入力してください`;

  return (
    <Card>
      <CardHeader>
        <div className="space-y-1.5">
          <h2 className="font-heading text-base leading-snug font-medium">連絡先の編集</h2>
          {selected ? (
            <>
              <p className="text-xs text-muted-foreground">
                {KIND_LABELS[selected.kind]} / {selected.subtitle ?? '担当情報未設定'}
              </p>
              <div className="flex flex-wrap gap-2 pt-2">
                <Badge variant={selected.pending_response_count > 0 ? 'secondary' : 'outline'}>
                  {selected.pending_response_count > 0
                    ? `未完了 ${selected.pending_response_count}件`
                    : '未完了なし'}
                </Badge>
                <Badge variant={hasUnsavedChanges ? 'secondary' : 'outline'}>
                  {hasUnsavedChanges ? '未保存の変更あり' : '保存済み内容'}
                </Badge>
                <Badge variant="outline">推奨 {selectedRecommendedChannels}</Badge>
              </div>
            </>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {!selected ? (
          <p className="text-sm text-muted-foreground">
            左の一覧から送付先を選択すると、連絡先を編集できます。
          </p>
        ) : (
          <form className="space-y-5" onSubmit={handleSubmit(() => saveMutation.mutate())}>
            <section
              aria-label="保存前チェック"
              className="grid gap-3 rounded-lg border border-border/70 bg-muted/20 p-3 text-sm sm:grid-cols-3"
            >
              <div>
                <p className="text-xs font-medium text-muted-foreground">保存後の送付</p>
                <p className="mt-1 font-semibold text-foreground">{saveReviewLabel}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">最終連絡</p>
                <p className="mt-1 font-semibold text-foreground">
                  {formatLastContacted(selected.last_contacted_at)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">成功チャネル</p>
                <p className="mt-1 font-semibold text-foreground">
                  {labelOf(selected.last_success_channel)}
                </p>
              </div>
            </section>

            <div className={fieldClassName}>
              <Label htmlFor="contact-name">宛先</Label>
              <Input id="contact-name" {...register('name')} placeholder="送付先の名称" />
            </div>

            {showContactPerson && (
              <div className={fieldClassName}>
                <Label htmlFor="contact-person">{contactPersonLabel}</Label>
                <Input
                  id="contact-person"
                  {...register('contactPerson')}
                  placeholder={contactPersonLabel}
                />
              </div>
            )}

            <div className={fieldClassName}>
              <Label htmlFor="contact-fax">FAX</Label>
              <Input id="contact-fax" {...register('fax')} placeholder="03-1234-5678" />
            </div>

            <div className={fieldClassName}>
              <Label htmlFor="contact-phone">電話</Label>
              <Input id="contact-phone" {...register('phone')} placeholder="03-1234-1111" />
            </div>

            {showEmail && (
              <div className={fieldClassName}>
                <Label htmlFor="contact-email">メール</Label>
                <Input
                  id="contact-email"
                  type="email"
                  {...register('email')}
                  placeholder="contact@example.com"
                />
              </div>
            )}

            <div className={fieldClassName}>
              <Label htmlFor="contact-preferred-method">送付方法</Label>
              <Controller
                control={control}
                name="preferred_contact_method"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="contact-preferred-method">
                      <SelectValue placeholder="送付方法を選択" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE_METHOD}>未設定</SelectItem>
                      {CONTACT_METHOD_OPTIONS.map((method) => (
                        <SelectItem key={method} value={method}>
                          {contactMethodLabel(method)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="rounded-lg border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
              <div>最終連絡: {formatLastContacted(selected.last_contacted_at)}</div>
              <div>成功チャネル: {labelOf(selected.last_success_channel)}</div>
            </div>

            <div className="pt-1">
              <Button type="submit" className="min-h-11 w-full" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? '保存中…' : '送付先を保存する'}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
