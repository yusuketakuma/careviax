'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminServiceAreasShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { SERVICE_AREAS_API_PATH, buildServiceAreaApiPath } from '@/lib/service-areas/api-paths';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { parseJsonObjectText } from '@/lib/admin/json-editor';

type PharmacySite = {
  id: string;
  name: string;
};

type ServiceArea = {
  id: string;
  site_id: string;
  name: string;
  area_type: 'radius' | 'polygon';
  geo_data: Record<string, unknown>;
  notes: string | null;
  site: PharmacySite;
};

type ServiceAreasResponse = {
  data: ServiceArea[];
  total_count?: number;
  visible_count?: number;
  hidden_count?: number;
  truncated?: boolean;
  count_basis?: 'service_areas';
};

type ServiceAreaForm = {
  id: string;
  site_id: string;
  name: string;
  area_type: ServiceArea['area_type'];
  geoText: string;
  notes: string;
};

const EMPTY_SERVICE_AREA_FORM: ServiceAreaForm = {
  id: '',
  site_id: '',
  name: '',
  area_type: 'radius',
  geoText: '{\n  "match_keywords": [],\n  "facility_ids": []\n}',
  notes: '',
};

const SERVICE_AREA_SAVE_BLOCKER_ID = 'service-area-save-blocker';
const SERVICE_AREA_GEO_ERROR_ID = 'service-area-geo-error';

function getServiceAreaGeoError(geoText: string) {
  try {
    parseJsonObjectText(geoText, 'エリア定義(JSON) の形式が不正です');
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'エリア定義(JSON) の形式が不正です';
  }
}

function getServiceAreaSaveBlocker(form: ServiceAreaForm, geoError: string | null) {
  if (!form.site_id) return '拠点を選択してください。';
  if (form.name.trim().length === 0) return 'エリア名を入力してください。';
  return geoError;
}

export default function ServiceAreasPage() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ServiceAreaForm>(EMPTY_SERVICE_AREA_FORM);
  const [deleteTarget, setDeleteTarget] = useState<ServiceArea | null>(null);
  const geoError = getServiceAreaGeoError(form.geoText);
  const saveBlocker = getServiceAreaSaveBlocker(form, geoError);

  const sitesQuery = useQuery({
    queryKey: ['service-areas-sites', orgId],
    queryFn: async () => {
      const res = await fetch('/api/pharmacy-sites', {
        headers: buildOrgHeaders(orgId),
      });
      if (!res.ok) throw new Error('拠点一覧の取得に失敗しました');
      return res.json() as Promise<{ data: PharmacySite[] }>;
    },
    enabled: !!orgId,
  });

  const areasQuery = useQuery({
    queryKey: ['service-areas', orgId],
    queryFn: async () => {
      const res = await fetch(SERVICE_AREAS_API_PATH, {
        headers: buildOrgHeaders(orgId),
      });
      if (!res.ok) throw new Error('訪問エリアの取得に失敗しました');
      return res.json() as Promise<ServiceAreasResponse>;
    },
    enabled: !!orgId,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const blocker = getServiceAreaSaveBlocker(form, getServiceAreaGeoError(form.geoText));
      if (blocker) throw new Error(blocker);

      const geoData = parseJsonObjectText(form.geoText, 'エリア定義(JSON) の形式が不正です');

      // buildServiceAreaApiPath validates during URL construction, so a dot
      // segment id fails closed before the mutating PATCH side effect.
      const res = await fetch(form.id ? buildServiceAreaApiPath(form.id) : SERVICE_AREAS_API_PATH, {
        method: form.id ? 'PATCH' : 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          site_id: form.site_id,
          name: form.name.trim(),
          area_type: form.area_type,
          geo_data: geoData,
          notes: form.notes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? '訪問エリアの保存に失敗しました');
      }
    },
    onSuccess: async () => {
      toast.success(form.id ? '訪問エリアを更新しました' : '訪問エリアを登録しました');
      setForm(EMPTY_SERVICE_AREA_FORM);
      await queryClient.invalidateQueries({ queryKey: ['service-areas', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '訪問エリアの保存に失敗しました');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // buildServiceAreaApiPath validates before fetch, so a dot-segment id fails closed
      // before the destructive DELETE side effect.
      const res = await fetch(buildServiceAreaApiPath(id), {
        method: 'DELETE',
        headers: buildOrgHeaders(orgId),
      });
      if (!res.ok) throw new Error('訪問エリアの削除に失敗しました');
    },
    onSuccess: async (_data, deletedId) => {
      toast.success('訪問エリアを削除しました');
      if (form.id === deletedId) {
        setForm(EMPTY_SERVICE_AREA_FORM);
      }
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['service-areas', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '訪問エリアの削除に失敗しました');
    },
  });

  const sites = sitesQuery.data?.data ?? [];
  const serviceAreas = areasQuery.data?.data ?? [];
  const totalServiceAreaCount = areasQuery.data?.total_count ?? serviceAreas.length;
  const visibleServiceAreaCount = areasQuery.data?.visible_count ?? serviceAreas.length;
  const hiddenServiceAreaCount =
    areasQuery.data?.hidden_count ?? Math.max(totalServiceAreaCount - serviceAreas.length, 0);
  const serviceAreaListSummary = areasQuery.data
    ? areasQuery.data.truncated || hiddenServiceAreaCount > 0
      ? `先頭${visibleServiceAreaCount.toLocaleString()}件を表示 / 他${hiddenServiceAreaCount.toLocaleString()}件`
      : `登録済み ${totalServiceAreaCount.toLocaleString()}件`
    : null;

  return (
    <PageScaffold>
      <AdminPageHeader
        title="訪問エリア設定"
        description="拠点ごとの訪問可能エリアを管理します。`match_keywords` や `facility_ids` を使うと患者登録時に警告できます。"
        shortcuts={getAdminServiceAreasShortcutLinks()}
      />

      <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {form.id ? '訪問エリアを編集' : '訪問エリアを登録'}
            </CardTitle>
            <CardDescription>
              GeoJSON をそのまま保存しても構いません。警告判定には `match_keywords` と
              `facility_ids` を利用します。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="service-area-site">拠点</Label>
              <Select
                value={form.site_id}
                onValueChange={(value) =>
                  setForm((current) => ({ ...current, site_id: value ?? '' }))
                }
              >
                <SelectTrigger
                  id="service-area-site"
                  className="min-h-[44px] w-full sm:min-h-[44px]"
                >
                  <SelectValue placeholder="拠点を選択" />
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
                <p
                  role="status"
                  aria-live="polite"
                  className="flex flex-wrap items-center gap-x-2 text-sm text-destructive"
                >
                  <span>
                    {sitesQuery.error instanceof Error
                      ? sitesQuery.error.message
                      : '拠点一覧の取得に失敗しました'}
                  </span>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-sm"
                    onClick={() => void sitesQuery.refetch()}
                  >
                    再試行
                  </Button>
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="service-area-name">エリア名</Label>
              <Input
                id="service-area-name"
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="北多摩エリア"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="service-area-type">エリア種別</Label>
              <Select
                value={form.area_type}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    area_type: (value ?? 'radius') as 'radius' | 'polygon',
                  }))
                }
              >
                <SelectTrigger
                  id="service-area-type"
                  className="min-h-[44px] w-full sm:min-h-[44px]"
                >
                  <SelectValue>{form.area_type}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="radius">radius</SelectItem>
                  <SelectItem value="polygon">polygon</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="service-area-geo">エリア定義(JSON)</Label>
              <Textarea
                id="service-area-geo"
                rows={12}
                className="font-mono text-xs"
                value={form.geoText}
                aria-invalid={geoError ? true : undefined}
                aria-describedby={geoError ? SERVICE_AREA_GEO_ERROR_ID : undefined}
                onChange={(event) =>
                  setForm((current) => ({ ...current, geoText: event.target.value }))
                }
              />
              {geoError ? (
                <p id={SERVICE_AREA_GEO_ERROR_ID} className="text-xs text-destructive">
                  {geoError}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="service-area-notes">備考</Label>
              <Textarea
                id="service-area-notes"
                rows={3}
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({ ...current, notes: event.target.value }))
                }
              />
            </div>

            <div className="flex gap-2">
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || Boolean(saveBlocker)}
                aria-describedby={saveBlocker ? SERVICE_AREA_SAVE_BLOCKER_ID : undefined}
              >
                {saveMutation.isPending ? '保存中...' : form.id ? '更新する' : '登録する'}
              </Button>
              {form.id ? (
                <Button variant="outline" onClick={() => setForm(EMPTY_SERVICE_AREA_FORM)}>
                  キャンセル
                </Button>
              ) : null}
            </div>
            {saveBlocker ? (
              <p id={SERVICE_AREA_SAVE_BLOCKER_ID} className="text-xs text-destructive">
                {saveBlocker}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">登録済みエリア</CardTitle>
            {serviceAreaListSummary ? (
              <p className="text-sm text-muted-foreground">{serviceAreaListSummary}</p>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-3">
            {areasQuery.isError ? (
              <ErrorState
                variant="server"
                size="inline"
                title="訪問エリアを取得できませんでした"
                description={
                  areasQuery.error instanceof Error
                    ? areasQuery.error.message
                    : '訪問エリアの取得に失敗しました'
                }
                action={{ label: '再試行', onClick: () => void areasQuery.refetch() }}
                live="polite"
              />
            ) : areasQuery.isPending ? (
              // isPending (not isLoading) so an unresolved orgId — which disables the query
              // (enabled: !!orgId) and leaves it pending-but-not-fetching — also shows loading
              // rather than the empty-state.
              <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
                訪問エリアを読み込み中...
              </p>
            ) : serviceAreas.length === 0 ? (
              <p className="text-sm text-muted-foreground">まだ訪問エリアはありません。</p>
            ) : (
              serviceAreas.map((area) => (
                <div key={area.id} className="rounded-lg border border-border/60 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-foreground">{area.name}</p>
                      <Badge variant="outline">{area.site.name}</Badge>
                      <Badge variant="outline">{area.area_type}</Badge>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`${area.name}（${area.site.name}）を編集`}
                        onClick={() =>
                          setForm({
                            id: area.id,
                            site_id: area.site_id,
                            name: area.name,
                            area_type: area.area_type,
                            geoText: JSON.stringify(area.geo_data ?? {}, null, 2),
                            notes: area.notes ?? '',
                          })
                        }
                      >
                        編集
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDeleteTarget(area)}
                        disabled={deleteMutation.isPending}
                        aria-label={`${area.name}（${area.site.name}）を削除`}
                      >
                        削除
                      </Button>
                    </div>
                  </div>
                  {area.notes ? (
                    <p className="mt-2 text-sm text-muted-foreground">{area.notes}</p>
                  ) : null}
                  <pre className="mt-3 overflow-x-auto rounded-md bg-muted/40 p-3 text-xs leading-5 text-foreground">
                    {JSON.stringify(area.geo_data ?? {}, null, 2)}
                  </pre>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) {
            setDeleteTarget(null);
          }
        }}
        title="訪問エリアを削除しますか"
        description={
          deleteTarget
            ? `${deleteTarget.name}（${deleteTarget.site.name} / ${deleteTarget.area_type}）を削除します。この操作は取り消せません。患者登録時の訪問エリア警告にも反映されます。`
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
