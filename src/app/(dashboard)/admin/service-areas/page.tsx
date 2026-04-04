'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminServiceAreasShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { PageScaffold } from '@/components/layout/page-scaffold';

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

export default function ServiceAreasPage() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    id: '',
    site_id: '',
    name: '',
    area_type: 'radius',
    geoText: '{\n  "match_keywords": [],\n  "facility_ids": []\n}',
    notes: '',
  });

  const sitesQuery = useQuery({
    queryKey: ['service-areas-sites', orgId],
    queryFn: async () => {
      const res = await fetch('/api/pharmacy-sites', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('拠点一覧の取得に失敗しました');
      return res.json() as Promise<{ data: PharmacySite[] }>;
    },
    enabled: !!orgId,
  });

  const areasQuery = useQuery({
    queryKey: ['service-areas', orgId],
    queryFn: async () => {
      const res = await fetch('/api/service-areas', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('訪問エリアの取得に失敗しました');
      return res.json() as Promise<{ data: ServiceArea[] }>;
    },
    enabled: !!orgId,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      let geoData: Record<string, unknown>;
      try {
        geoData = JSON.parse(form.geoText) as Record<string, unknown>;
      } catch {
        throw new Error('エリア定義(JSON) の形式が不正です');
      }

      const res = await fetch(form.id ? `/api/service-areas/${form.id}` : '/api/service-areas', {
        method: form.id ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          site_id: form.site_id,
          name: form.name,
          area_type: form.area_type,
          geo_data: geoData,
          notes: form.notes || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? '訪問エリアの保存に失敗しました');
      }
    },
    onSuccess: async () => {
      toast.success(form.id ? '訪問エリアを更新しました' : '訪問エリアを登録しました');
      setForm({
        id: '',
        site_id: '',
        name: '',
        area_type: 'radius',
        geoText: '{\n  "match_keywords": [],\n  "facility_ids": []\n}',
        notes: '',
      });
      await queryClient.invalidateQueries({ queryKey: ['service-areas', orgId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/service-areas/${id}`, {
        method: 'DELETE',
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('訪問エリアの削除に失敗しました');
    },
    onSuccess: async () => {
      toast.success('訪問エリアを削除しました');
      await queryClient.invalidateQueries({ queryKey: ['service-areas', orgId] });
    },
  });

  const sites = sitesQuery.data?.data ?? [];
  const serviceAreas = areasQuery.data?.data ?? [];

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
              <select
                id="service-area-site"
                value={form.site_id}
                onChange={(event) =>
                  setForm((current) => ({ ...current, site_id: event.target.value }))
                }
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">拠点を選択</option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
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
              <select
                id="service-area-type"
                value={form.area_type}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    area_type: event.target.value as 'radius' | 'polygon',
                  }))
                }
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="radius">radius</option>
                <option value="polygon">polygon</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="service-area-geo">エリア定義(JSON)</Label>
              <Textarea
                id="service-area-geo"
                rows={12}
                className="font-mono text-xs"
                value={form.geoText}
                onChange={(event) =>
                  setForm((current) => ({ ...current, geoText: event.target.value }))
                }
              />
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
                disabled={saveMutation.isPending || !form.site_id || !form.name}
              >
                {saveMutation.isPending ? '保存中...' : form.id ? '更新する' : '登録する'}
              </Button>
              {form.id ? (
                <Button
                  variant="outline"
                  onClick={() =>
                    setForm({
                      id: '',
                      site_id: '',
                      name: '',
                      area_type: 'radius',
                      geoText: '{\n  "match_keywords": [],\n  "facility_ids": []\n}',
                      notes: '',
                    })
                  }
                >
                  キャンセル
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">登録済みエリア</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {serviceAreas.length === 0 ? (
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
                        onClick={() => deleteMutation.mutate(area.id)}
                        disabled={deleteMutation.isPending}
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
    </PageScaffold>
  );
}
