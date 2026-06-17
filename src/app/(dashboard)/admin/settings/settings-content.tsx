'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Database, HardDriveDownload, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  SCOPE_LABELS,
  type SettingScope,
  type SettingValueItem,
} from '@/lib/admin/settings-catalog';
import { parseJsonObjectText } from '@/lib/admin/json-editor';
import { useOrgId } from '@/lib/hooks/use-org-id';

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

function statusBadgeClass(status: string) {
  switch (status) {
    case 'ok':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    case 'degraded':
      return 'bg-amber-100 text-amber-800 border-amber-200';
    case 'down':
    case 'error':
      return 'bg-rose-100 text-rose-800 border-rose-200';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

function SettingRow({
  item,
  onChange,
}: {
  item: SettingValueItem;
  onChange: (key: string, value: string) => void;
}) {
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
              <SelectValue />
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
          <Input
            id={`setting-${item.key}`}
            type={item.type === 'number' ? 'number' : 'text'}
            value={item.value}
            onChange={(event) => onChange(item.key, event.target.value)}
            className="h-8 text-sm"
          />
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
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? '設定の取得に失敗しました');
      }
      return response.json() as Promise<SettingResponse>;
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

      const response = await fetch('/api/settings', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          scope,
          scope_id: scopeId,
          values: Object.fromEntries(itemsForSave.map((item) => [item.key, item.value])),
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? '設定の保存に失敗しました');
      }
      return response.json() as Promise<SettingResponse>;
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
    onError: (error: Error) => {
      toast.error(error.message);
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
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="form">フォーム編集</SelectItem>
              <SelectItem value="json">JSON編集</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={!isDirty || saveMutation.isPending}
          >
            <Save className="mr-1.5 size-3.5" aria-hidden="true" />
            {saveMutation.isPending ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="px-4 py-0">
          {query.isLoading ? (
            <div className="py-6 text-sm text-muted-foreground">設定を読み込んでいます...</div>
          ) : query.error instanceof Error ? (
            <div className="py-6 text-sm text-rose-700">{query.error.message}</div>
          ) : editorMode === 'json' ? (
            <div className="space-y-3 py-4">
              <p className="text-xs text-muted-foreground">
                現在の scope 値を JSON として編集できます。保存時に設定キー単位で反映します。
              </p>
              <Textarea
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
      if (!response.ok) throw new Error('プロフィールの取得に失敗しました');
      return response.json() as Promise<{ data: CurrentProfile }>;
    },
    enabled: !!orgId,
    staleTime: 300_000,
  });

  const sitesQuery = useQuery({
    queryKey: ['pharmacy-sites', orgId, 'admin-settings'],
    queryFn: async () => {
      const response = await fetch('/api/pharmacy-sites', {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('店舗一覧の取得に失敗しました');
      return response.json() as Promise<{ data: SiteOption[] }>;
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
        <CardContent className="grid gap-4 md:grid-cols-3">
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
                <SelectValue placeholder="店舗を選択" />
              </SelectTrigger>
              <SelectContent>
                {sites.map((site) => (
                  <SelectItem key={site.id} value={site.id}>
                    {site.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <Badge variant="outline" className={`mt-2 text-xs ${statusBadgeClass(value)}`}>
            {value}
          </Badge>
          <p className="mt-2 text-xs text-muted-foreground">{description}</p>
        </div>
        <div className="rounded-full border border-border bg-background p-2">
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        </div>
      </CardContent>
    </Card>
  );
}
