'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Database, HardDriveDownload, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { StateBadge } from '@/components/ui/state-badge';
import type { StatusRole } from '@/lib/constants/status-tokens';
import { HEALTH_STATUS_LABELS } from '@/lib/constants/status-labels';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import {
  getSettingRangeError,
  SCOPE_LABELS,
  type SettingScope,
  type SettingValueItem,
} from '@/lib/admin/settings-catalog';
import { parseJsonObjectText } from '@/lib/admin/json-editor';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { messageFromError } from '@/lib/utils/error-message';

type SettingResponse = {
  data: {
    scope: SettingScope;
    scope_id: string | null;
    items: SettingValueItem[];
  };
};

type SiteOption = {
  id: string;
  name: string;
};

type CurrentProfile = {
  id: string;
  name: string;
  defaultSiteId: string | null;
};

type HealthPayload = {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  checks: Record<
    string,
    {
      status: string;
      latencyMs?: number;
      message?: string;
    }
  >;
};

const EMPTY_SETTING_ITEMS: SettingValueItem[] = [];
const HEALTH_REFETCH_INTERVAL_MS = 60_000;

function statusBadgeRole(status: string): StatusRole | null {
  switch (status) {
    case 'ok':
      return 'done';
    case 'degraded':
      return 'confirm';
    case 'down':
    case 'error':
      return 'blocked';
    default:
      return null;
  }
}

function SettingRow({
  item,
  onChange,
}: {
  item: SettingValueItem;
  onChange: (key: string, value: string) => void;
}) {
  const rangeError = getSettingRangeError(item, item.value);
  const errorId = rangeError ? `setting-${item.key}-error` : undefined;

  return (
    <div className="flex items-start gap-4 border-b border-border py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <Label htmlFor={`setting-${item.key}`} className="text-sm font-medium">
          {item.label}
        </Label>
        {item.description ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
        ) : null}
        <p className="mt-0.5 font-mono text-xs text-muted-foreground/60">{item.key}</p>
      </div>
      <div className="w-56 shrink-0">
        {item.type === 'select' || item.type === 'boolean' ? (
          <Select
            value={item.value}
            onValueChange={(value) => onChange(item.key, value ?? item.value)}
          >
            <SelectTrigger id={`setting-${item.key}`} className="h-8 text-sm">
              <SelectValue>
                {(item.options ?? []).find((option) => option.value === item.value)?.label ??
                  item.value}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(item.options ?? []).map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <>
            <Input
              id={`setting-${item.key}`}
              type={item.type === 'number' ? 'number' : 'text'}
              value={item.value}
              min={item.type === 'number' ? item.min : undefined}
              max={item.type === 'number' ? item.max : undefined}
              onChange={(event) => onChange(item.key, event.target.value)}
              className="h-8 text-sm"
              aria-invalid={!!rangeError}
              aria-describedby={errorId}
            />
            {rangeError ? (
              <p id={errorId} className="mt-1 text-xs text-destructive">
                {rangeError}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function ScopePanel({
  orgId,
  scope,
  scopeId,
  targetLabel,
}: {
  orgId: string;
  scope: SettingScope;
  scopeId: string | null;
  targetLabel?: string | null;
}) {
  const queryClient = useQueryClient();
  const [draftItems, setDraftItems] = useState<SettingValueItem[] | null>(null);
  const [editorMode, setEditorMode] = useState<'form' | 'json'>('form');
  const [jsonDraft, setJsonDraft] = useState('');
  const settingsQueryKey = ['admin-settings', orgId, scope, scopeId] as const;

  const query = useQuery({
    queryKey: settingsQueryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ scope });
      if (scopeId) {
        params.set('scope_id', scopeId);
      }

      const response = await fetch(`/api/settings?${params.toString()}`, {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<SettingResponse>(response, '設定の取得に失敗しました');
    },
    enabled: !!orgId && (scope !== 'site' || !!scopeId),
    staleTime: 300_000,
  });
  const fetchedItems = query.data?.data.items ?? EMPTY_SETTING_ITEMS;
  const displayedItems = draftItems ?? fetchedItems;
  const serializedDisplayedItems = useMemo(
    () =>
      JSON.stringify(
        Object.fromEntries(displayedItems.map((item) => [item.key, item.value])),
        null,
        2,
      ),
    [displayedItems],
  );
  const serializedFetchedItems = useMemo(
    () =>
      JSON.stringify(
        Object.fromEntries(fetchedItems.map((item) => [item.key, item.value])),
        null,
        2,
      ),
    [fetchedItems],
  );

  const isDirty = useMemo(() => {
    if (editorMode === 'json') {
      return jsonDraft.trim() !== serializedFetchedItems.trim();
    }
    const original = JSON.stringify(fetchedItems);
    const current = JSON.stringify(displayedItems);
    return original !== current;
  }, [displayedItems, editorMode, fetchedItems, jsonDraft, serializedFetchedItems]);

  // フォーム編集モードでコンプライアンス上のレンジ(min/max)を外れている項目がある間は保存を止める。
  // JSON編集モードは保存を試みた時点でパース後の値を検証する(下記 mutationFn)。
  const hasFormRangeError = useMemo(() => {
    if (editorMode !== 'form') return false;
    return displayedItems.some((item) => getSettingRangeError(item, item.value) !== null);
  }, [displayedItems, editorMode]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      let itemsForSave = displayedItems;
      if (editorMode === 'json') {
        const parsed = parseJsonObjectText(
          jsonDraft,
          'JSON はキーと値のオブジェクト形式で入力してください',
        );
        itemsForSave = displayedItems.map((item) => ({
          ...item,
          value:
            typeof parsed[item.key] === 'string'
              ? (parsed[item.key] as string)
              : parsed[item.key] == null
                ? ''
                : String(parsed[item.key]),
        }));
      }

      // JSON編集モードはフォームの行内エラー表示を経由しないため、送信直前にレンジを検証する。
      const rangeError = itemsForSave
        .map((item) => getSettingRangeError(item, item.value))
        .find((message): message is string => message != null);
      if (rangeError) {
        throw new Error(rangeError);
      }

      const response = await fetch('/api/settings', {
        method: 'PATCH',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          scope,
          scope_id: scopeId,
          values: Object.fromEntries(itemsForSave.map((item) => [item.key, item.value])),
        }),
      });
      return readApiJson<SettingResponse>(response, '設定の保存に失敗しました');
    },
    onSuccess: async (payload) => {
      queryClient.setQueryData(settingsQueryKey, payload);
      setDraftItems(null);
      setJsonDraft(
        JSON.stringify(
          Object.fromEntries(payload.data.items.map((item) => [item.key, item.value])),
          null,
          2,
        ),
      );
      await queryClient.invalidateQueries({ queryKey: settingsQueryKey });
      toast.success(`${SCOPE_LABELS[scope].label}設定を保存しました`);
    },
    onError: (error) => {
      toast.error(messageFromError(error, '設定の保存に失敗しました'));
    },
  });

  function handleChange(key: string, value: string) {
    setDraftItems((current) =>
      (current ?? displayedItems).map((item) => (item.key === key ? { ...item, value } : item)),
    );
  }

  if (scope === 'site' && !scopeId) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">
          設定対象の店舗を選択してください。
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={`text-xs ${SCOPE_LABELS[scope].badge}`}>
            {SCOPE_LABELS[scope].label}
          </Badge>
          {targetLabel ? (
            <span className="text-sm text-muted-foreground">{targetLabel}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={editorMode}
            onValueChange={(value) => {
              const nextMode = (value as 'form' | 'json') ?? 'form';
              setEditorMode(nextMode);
              if (nextMode === 'json') {
                setJsonDraft(serializedDisplayedItems);
              }
            }}
          >
            <SelectTrigger className="h-8 w-[140px] text-xs" aria-label="設定編集モード">
              <SelectValue>{editorMode === 'json' ? 'JSON編集' : 'フォーム編集'}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="form">フォーム編集</SelectItem>
              <SelectItem value="json">JSON編集</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={!isDirty || saveMutation.isPending || hasFormRangeError}
          >
            <Save className="mr-1.5 size-3.5" aria-hidden="true" />
            {saveMutation.isPending ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="px-4 py-0">
          {query.isLoading ? (
            <div className="py-4" role="status" aria-label="設定を読み込み中" aria-live="polite">
              <SkeletonRows rows={3} cols={2} status={false} />
            </div>
          ) : query.error instanceof Error ? (
            <div className="py-6 text-sm text-destructive">{query.error.message}</div>
          ) : editorMode === 'json' ? (
            <div className="space-y-3 py-4">
              <p className="text-xs text-muted-foreground">
                現在の scope 値を JSON として編集できます。保存時に設定キー単位で反映します。
              </p>
              <Textarea
                aria-label="設定JSON"
                value={jsonDraft}
                onChange={(event) => setJsonDraft(event.target.value)}
                className="min-h-[320px] font-mono text-xs"
              />
            </div>
          ) : (
            displayedItems.map((item) => (
              <SettingRow key={item.key} item={item} onChange={handleChange} />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function SettingsContent() {
  const orgId = useOrgId();
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');

  const profileQuery = useQuery({
    queryKey: ['me-profile', orgId, 'admin-settings'],
    queryFn: async () => {
      const response = await fetch('/api/me/profile');
      return readApiJson<{ data: CurrentProfile }>(response, 'プロフィールの取得に失敗しました');
    },
    enabled: !!orgId,
    staleTime: 300_000,
  });

  const sitesQuery = useQuery({
    queryKey: ['pharmacy-sites', orgId, 'admin-settings'],
    queryFn: async () => {
      const response = await fetch('/api/pharmacy-sites', {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<{ data: SiteOption[] }>(response, '店舗一覧の取得に失敗しました');
    },
    enabled: !!orgId,
    staleTime: 300_000,
  });

  const healthQuery = useQuery({
    queryKey: ['admin-health-monitor'],
    queryFn: async () => {
      const response = await fetch('/api/health');
      if (!response.ok && response.status !== 503) {
        throw new Error('外部連携監視の取得に失敗しました');
      }
      return response.json() as Promise<HealthPayload>;
    },
    refetchInterval: HEALTH_REFETCH_INTERVAL_MS,
  });

  const sites = sitesQuery.data?.data ?? [];
  const resolvedSiteId =
    selectedSiteId || profileQuery.data?.data.defaultSiteId || sites[0]?.id || '';
  const selectedSite = sites.find((site) => site.id === resolvedSiteId) ?? null;
  const currentUser = profileQuery.data?.data ?? null;
  const healthChecks = healthQuery.data?.checks ?? {};

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="size-4" aria-hidden="true" />
            外部連携監視
          </CardTitle>
          <CardDescription>DB・バックアップ系の健全性を 60 秒ごとに確認します</CardDescription>
        </CardHeader>
        <CardContent className={healthQuery.isError ? '' : 'grid gap-4 md:grid-cols-3'}>
          {healthQuery.isError ? (
            // 取得失敗を永続「確認中」に畳まず、エラーと再試行を明示する(false-empty 封止)
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
              <span>
                {healthQuery.error instanceof Error
                  ? healthQuery.error.message
                  : '外部連携監視の取得に失敗しました'}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => healthQuery.refetch()}
              >
                再試行
              </Button>
            </div>
          ) : (
            <>
              <HealthCard
                title="全体ステータス"
                value={healthQuery.data?.status ?? 'loading'}
                description={
                  healthQuery.data?.timestamp
                    ? `更新: ${new Date(healthQuery.data.timestamp).toLocaleString('ja-JP')}`
                    : '監視情報を取得しています'
                }
                icon={Activity}
              />
              <HealthCard
                title="Database"
                value={healthChecks.database?.status ?? 'unknown'}
                description={
                  healthChecks.database?.latencyMs != null
                    ? `${healthChecks.database.latencyMs}ms`
                    : (healthChecks.database?.message ?? '未取得')
                }
                icon={Database}
              />
              <HealthCard
                title="Backups"
                value={healthChecks.backups?.status ?? 'unknown'}
                description={healthChecks.backups?.message ?? 'バックアップ監視'}
                icon={HardDriveDownload}
              />
            </>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="system">
        <TabsList className="mb-4">
          {(Object.keys(SCOPE_LABELS) as SettingScope[]).map((scope) => (
            <TabsTrigger key={scope} value={scope}>
              {SCOPE_LABELS[scope].label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="system">
          <ScopePanel orgId={orgId} scope="system" scopeId={null} />
        </TabsContent>

        <TabsContent value="organization">
          <ScopePanel orgId={orgId} scope="organization" scopeId={orgId} />
        </TabsContent>

        <TabsContent value="site" className="space-y-4">
          <div className="max-w-xs space-y-1.5">
            <Label htmlFor="admin-settings-site">対象店舗</Label>
            <Select
              value={resolvedSiteId}
              onValueChange={(value) => setSelectedSiteId(value ?? '')}
            >
              <SelectTrigger id="admin-settings-site">
                <SelectValue>{selectedSite?.name ?? '店舗を選択'}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {sites.map((site) => (
                  <SelectItem key={site.id} value={site.id}>
                    {site.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {sitesQuery.isError ? (
              // 取得失敗を空の店舗セレクタに畳まず、エラーと再試行を明示する(false-empty 封止)
              <p className="flex flex-wrap items-center gap-x-2 text-sm text-destructive">
                <span>
                  {sitesQuery.error instanceof Error
                    ? sitesQuery.error.message
                    : '店舗一覧の取得に失敗しました'}
                </span>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-sm"
                  onClick={() => sitesQuery.refetch()}
                >
                  再試行
                </Button>
              </p>
            ) : null}
          </div>
          <ScopePanel
            orgId={orgId}
            scope="site"
            scopeId={resolvedSiteId || null}
            targetLabel={selectedSite?.name ?? null}
          />
        </TabsContent>

        <TabsContent value="user">
          <ScopePanel
            orgId={orgId}
            scope="user"
            scopeId={currentUser?.id ?? null}
            targetLabel={currentUser ? `${currentUser.name} (${currentUser.id})` : null}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function HealthCard({
  title,
  value,
  description,
  icon: Icon,
}: {
  title: string;
  value: string;
  description: string;
  icon: typeof Activity;
}) {
  const role = statusBadgeRole(value);
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          {role ? (
            <StateBadge role={role} className="mt-2 text-xs">
              {HEALTH_STATUS_LABELS[value] ?? value}
            </StateBadge>
          ) : (
            <Badge variant="outline" className="mt-2 text-xs">
              {HEALTH_STATUS_LABELS[value] ?? value}
            </Badge>
          )}
          <p className="mt-2 text-xs text-muted-foreground">{description}</p>
        </div>
        <div className="rounded-full border border-border bg-background p-2">
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        </div>
      </CardContent>
    </Card>
  );
}
